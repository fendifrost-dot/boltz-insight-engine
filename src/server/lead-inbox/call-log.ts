// Pure RingCentral call-log shaping. No secrets and no network.
import { shopDate, shopDayBounds, SHOP_TIME_ZONE } from "../../lib/desk-schedule.ts";
import { normalizeLeadPhone } from "./phone.ts";

export const CALL_LOG_TIME_ZONE = SHOP_TIME_ZONE;
export const CALL_LOG_MAX_LOOKBACK_DAYS = 372;
export const CALL_LOG_MAX_PAGES = 8;
export const CALL_LOG_PER_PAGE = 1000;
export const READ_CALL_LOG_PERMISSION = "ReadCallLog";
export const COMPANY_CALL_LOG_PERMISSION = "FullCompanyCallLog";

export const READ_CALL_LOG_STEPS = [
  "Enable ReadCallLog on the RingCentral app that owns RINGCENTRAL_CLIENT_ID.",
  "Developer Console: https://developers.ringcentral.com/my-account.html#/applications — open that app, enable the application permission ReadCallLog, and save.",
  "Do not enable ReadCallRecording. This tool does not read call recordings.",
  "Generate a new JWT for the same user that already sends SMS and replace the RINGCENTRAL_JWT secret in Lovable Cloud.",
  "Do not paste the JWT, client secret, or token into chat.",
].join(" ");

export const EXTENSION_FALLBACK_NOTE =
  "Account call log was refused for this JWT user, so these records are the extension call log. Calls to the main line are included when that number is on this extension. Grant the user permission FullCompanyCallLog to read every extension.";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const TIME_OF_DAY_ORDER = ["morning", "afternoon", "evening", "night"] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];
export type TimeOfDay = (typeof TIME_OF_DAY_ORDER)[number];
export type CallDisposition = "answered" | "missed" | "voicemail" | "other";
export type CallDirection = "inbound" | "outbound";

const WEEKDAY_ALIASES: Record<string, WeekdayName> = {
  sun: "Sunday",
  sunday: "Sunday",
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
};

export function canonicalWeekday(value: string): WeekdayName | null {
  return WEEKDAY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function userCallLogSteps(permissionNames: readonly string[]): string {
  const names =
    permissionNames.length > 0 ? permissionNames.join(", ") : COMPANY_CALL_LOG_PERMISSION;
  return [
    `Grant the JWT user this RingCentral user permission: ${names}.`,
    "In the RingCentral Admin Portal, open the user that owns the JWT (the extension already used for SMS) and allow call log access.",
    "Account-wide history needs FullCompanyCallLog. The extension call log is available to that user without FullCompanyCallLog.",
    "The application permission ReadCallLog must also be enabled.",
  ].join(" ");
}

export type ParsedRingCentralError = {
  errorCode: string | null;
  permissionNames: string[];
  message: string | null;
};

function addPermissionName(names: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (/^[A-Za-z][A-Za-z0-9]{1,40}$/.test(trimmed)) names.add(trimmed);
}

export function parseRingCentralError(body: string): ParsedRingCentralError {
  let message: string | null = null;
  let errorCode: string | null = null;
  const names = new Set<string>();
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    if (typeof json["message"] === "string") message = json["message"];
    if (typeof json["errorCode"] === "string") errorCode = json["errorCode"];
    addPermissionName(names, json["permissionName"]);
    addPermissionName(names, json["permissionsName"]);
    if (Array.isArray(json["errors"])) {
      for (const item of json["errors"]) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        addPermissionName(names, record["permissionName"]);
        addPermissionName(names, record["permissionsName"]);
        if (typeof record["errorCode"] === "string") {
          const code = record["errorCode"];
          if (!errorCode || errorCode === "InsufficientPermissions") errorCode = code;
        }
      }
    }
  } catch {
    message = null;
  }
  for (const group of body.match(/\[([A-Za-z][A-Za-z0-9_, ]{0,200})\]/g) ?? []) {
    for (const part of group.slice(1, -1).split(",")) addPermissionName(names, part);
  }
  return { errorCode, permissionNames: [...names], message };
}

export function isAppCallLogDenial(error: {
  errorCode: string | null;
  permissionNames: readonly string[];
}): boolean {
  if (error.permissionNames.some((name) => name.toLowerCase() === "readcalllog")) return true;
  return error.errorCode === "CMN-401";
}

export function scopesOmitReadCallLog(scopes: readonly string[] | null): boolean {
  if (!scopes || scopes.length === 0) return false;
  return !scopes.some((scope) => scope.toLowerCase() === "readcalllog");
}

export type CallLogPageQuery = {
  level: "account" | "extension";
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
  direction?: "Inbound" | "Outbound";
  phoneNumber?: string;
};

/** Company or extension call-log URL. Phone numbers are digits only, with no leading plus. */
export function callLogRequestPath(query: CallLogPageQuery): string {
  const params = new URLSearchParams();
  params.set("view", "Detailed");
  params.set("type", "Voice");
  params.set("showBlocked", "true");
  params.set("dateFrom", query.dateFrom);
  params.set("dateTo", query.dateTo);
  params.set("page", String(query.page));
  const perPage = Math.min(CALL_LOG_PER_PAGE, Math.max(1, Math.trunc(query.perPage)));
  params.set("perPage", String(perPage));
  if (query.direction) params.set("direction", query.direction);
  if (query.phoneNumber) params.set("phoneNumber", query.phoneNumber.replace(/\D/g, ""));
  const base =
    query.level === "account"
      ? "/restapi/v1.0/account/~/call-log"
      : "/restapi/v1.0/account/~/extension/~/call-log";
  return `${base}?${params.toString()}`;
}

export type RawCallParty = {
  phoneNumber?: string;
  name?: string;
  extensionNumber?: string;
};

export type RawCallRecord = {
  id?: string;
  startTime?: string;
  duration?: number;
  type?: string;
  direction?: string;
  result?: string;
  from?: RawCallParty;
  to?: RawCallParty;
};

export type MappedCall = {
  id: string | null;
  at: string;
  weekday: WeekdayName;
  hour: number;
  timeOfDay: TimeOfDay;
  direction: CallDirection;
  from: string | null;
  to: string | null;
  callerIdName: string | null;
  externalPhone: string;
  result: CallDisposition;
  resultDetail: string;
  durationSeconds: number;
  startMs: number;
};

export type PublicCall = {
  id: string | null;
  at: string;
  weekday: WeekdayName;
  timeOfDay: TimeOfDay;
  direction: CallDirection;
  from: string | null;
  to: string | null;
  callerIdName: string | null;
  result: CallDisposition;
  resultDetail: string;
  durationSeconds: number;
};

export type CallSummaryGroup = {
  phone: string;
  callerIdName: string | null;
  count: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  voicemail: number;
  weekdays: string[];
  timesOfDay: string[];
  hours: number[];
  firstSeen: string;
  lastSeen: string;
};

export function classifyCallResult(result: string | undefined): CallDisposition {
  const value = (result ?? "").trim().toLowerCase();
  if (!value) return "other";
  if (value.includes("voicemail")) return "voicemail";
  if (
    value === "accepted" ||
    value === "call connected" ||
    value === "received" ||
    value === "reply"
  ) {
    return "answered";
  }
  if (
    value === "missed" ||
    value === "no answer" ||
    value === "busy" ||
    value === "declined" ||
    value === "rejected" ||
    value === "abandoned" ||
    value === "hang up" ||
    value === "stopped" ||
    value === "call failed" ||
    value === "call failure" ||
    value === "ip phone offline"
  ) {
    return "missed";
  }
  return "other";
}

export function timeOfDayForHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function chicagoCallStamp(instant: Date): {
  at: string;
  weekday: WeekdayName;
  hour: number;
  timeOfDay: TimeOfDay;
} | null {
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALL_LOG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(instant);
  const weekday = partValue(parts, "weekday");
  if (!(WEEKDAY_NAMES as readonly string[]).includes(weekday)) return null;
  let hour = Number(partValue(parts, "hour"));
  if (!Number.isInteger(hour)) return null;
  if (hour === 24) hour = 0;
  const offsetName = partValue(parts, "timeZoneName");
  const offsetMatch = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName);
  if (!offsetMatch) return null;
  const sign = offsetMatch[1] ?? "+";
  const hours = (offsetMatch[2] ?? "0").padStart(2, "0");
  const minutes = (offsetMatch[3] ?? "00").padStart(2, "0");
  const at = `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}T${String(hour).padStart(2, "0")}:${partValue(parts, "minute")}:${partValue(parts, "second")}${sign}${hours}:${minutes}`;
  return {
    at,
    weekday: weekday as WeekdayName,
    hour,
    timeOfDay: timeOfDayForHour(hour),
  };
}

function cleanName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function partyPhone(value: string | undefined): string | null {
  return normalizeLeadPhone(value);
}

export function mapCallRecord(raw: RawCallRecord, shopNumber: string | null): MappedCall | null {
  if (raw.type && raw.type !== "Voice") return null;
  const directionRaw = (raw.direction ?? "").trim().toLowerCase();
  if (directionRaw !== "inbound" && directionRaw !== "outbound") return null;
  const direction = directionRaw;
  const startMs = Date.parse(raw.startTime ?? "");
  if (!Number.isFinite(startMs)) return null;
  const stamp = chicagoCallStamp(new Date(startMs));
  if (!stamp) return null;
  const from = partyPhone(raw.from?.phoneNumber);
  const to = partyPhone(raw.to?.phoneNumber);
  const fromName = cleanName(raw.from?.name);
  const toName = cleanName(raw.to?.name);
  let externalPhone: string | null = null;
  let callerIdName: string | null = null;
  if (shopNumber && to === shopNumber && from !== shopNumber) {
    externalPhone = from;
    callerIdName = fromName;
  } else if (shopNumber && from === shopNumber && to !== shopNumber) {
    externalPhone = to;
    callerIdName = toName;
  } else if (direction === "outbound") {
    externalPhone = to;
    callerIdName = toName;
  } else {
    externalPhone = from;
    callerIdName = fromName;
  }
  const duration =
    typeof raw.duration === "number" && Number.isFinite(raw.duration) ? raw.duration : 0;
  return {
    id: raw.id?.trim() ? raw.id.trim().slice(0, 80) : null,
    at: stamp.at,
    weekday: stamp.weekday,
    hour: stamp.hour,
    timeOfDay: stamp.timeOfDay,
    direction,
    from,
    to,
    callerIdName,
    externalPhone: externalPhone ?? "unavailable",
    result: classifyCallResult(raw.result),
    resultDetail: (raw.result ?? "").trim().slice(0, 80),
    durationSeconds: Math.max(0, Math.round(duration)),
    startMs,
  };
}

export function publicCall(call: MappedCall): PublicCall {
  return {
    id: call.id,
    at: call.at,
    weekday: call.weekday,
    timeOfDay: call.timeOfDay,
    direction: call.direction,
    from: call.from,
    to: call.to,
    callerIdName: call.callerIdName,
    result: call.result,
    resultDetail: call.resultDetail,
    durationSeconds: call.durationSeconds,
  };
}

export type CallLogFilter = {
  direction: CallDirection | null;
  phone: string | null;
  weekday: WeekdayName | null;
  shopNumber: string | null;
  line: "any" | "main";
};

export function callMatches(call: MappedCall, filter: CallLogFilter): boolean {
  if (filter.direction && call.direction !== filter.direction) return false;
  if (filter.weekday && call.weekday !== filter.weekday) return false;
  if (filter.phone && call.from !== filter.phone && call.to !== filter.phone) return false;
  if (filter.line === "main") {
    if (!filter.shopNumber) return false;
    if (call.from !== filter.shopNumber && call.to !== filter.shopNumber) return false;
  }
  return true;
}

function ranked(
  counts: Map<string, number>,
  tie: (left: string, right: string) => number,
): string[] {
  return [...counts.keys()].sort((left, right) => {
    const diff = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
    return diff !== 0 ? diff : tie(left, right);
  });
}

export function summarizeCalls(
  calls: readonly MappedCall[],
  limit: number,
): { groups: CallSummaryGroup[]; groupCount: number } {
  type Bucket = {
    phone: string;
    names: Map<string, number>;
    count: number;
    inbound: number;
    outbound: number;
    answered: number;
    missed: number;
    voicemail: number;
    weekdays: Map<string, number>;
    times: Map<string, number>;
    hours: Map<number, number>;
    first: MappedCall;
    last: MappedCall;
  };
  const buckets = new Map<string, Bucket>();
  for (const call of calls) {
    const key = call.externalPhone;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        phone: key,
        names: new Map(),
        count: 0,
        inbound: 0,
        outbound: 0,
        answered: 0,
        missed: 0,
        voicemail: 0,
        weekdays: new Map(),
        times: new Map(),
        hours: new Map(),
        first: call,
        last: call,
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (call.direction === "inbound") bucket.inbound += 1;
    else bucket.outbound += 1;
    if (call.result === "answered") bucket.answered += 1;
    if (call.result === "missed") bucket.missed += 1;
    if (call.result === "voicemail") bucket.voicemail += 1;
    bucket.weekdays.set(call.weekday, (bucket.weekdays.get(call.weekday) ?? 0) + 1);
    bucket.times.set(call.timeOfDay, (bucket.times.get(call.timeOfDay) ?? 0) + 1);
    bucket.hours.set(call.hour, (bucket.hours.get(call.hour) ?? 0) + 1);
    if (call.callerIdName) {
      bucket.names.set(call.callerIdName, (bucket.names.get(call.callerIdName) ?? 0) + 1);
    }
    if (call.startMs < bucket.first.startMs) bucket.first = call;
    if (call.startMs > bucket.last.startMs) bucket.last = call;
  }

  const groups = [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.phone.localeCompare(right.phone))
    .map((bucket): CallSummaryGroup => {
      const name = ranked(bucket.names, (left, right) => left.localeCompare(right))[0] ?? null;
      return {
        phone: bucket.phone,
        callerIdName: name,
        count: bucket.count,
        inbound: bucket.inbound,
        outbound: bucket.outbound,
        answered: bucket.answered,
        missed: bucket.missed,
        voicemail: bucket.voicemail,
        weekdays: ranked(bucket.weekdays, (left, right) => {
          return (
            WEEKDAY_NAMES.indexOf(left as WeekdayName) - WEEKDAY_NAMES.indexOf(right as WeekdayName)
          );
        }),
        timesOfDay: ranked(bucket.times, (left, right) => {
          return (
            TIME_OF_DAY_ORDER.indexOf(left as TimeOfDay) -
            TIME_OF_DAY_ORDER.indexOf(right as TimeOfDay)
          );
        }),
        hours: [...bucket.hours.keys()].sort((left, right) => {
          const diff = (bucket.hours.get(right) ?? 0) - (bucket.hours.get(left) ?? 0);
          return diff !== 0 ? diff : left - right;
        }),
        firstSeen: bucket.first.at,
        lastSeen: bucket.last.at,
      };
    });
  return { groups: groups.slice(0, limit), groupCount: groups.length };
}

const DATE_ONLY = /^20\d{2}-\d{2}-\d{2}$/;

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T12:00:00Z`);
  const end = Date.parse(`${later}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function parseBound(value: string, bound: "start" | "end"): Date | null {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    try {
      const window = shopDayBounds(trimmed);
      const instant = bound === "start" ? window.start : window.end;
      const date = new Date(instant);
      if (bound === "end") return new Date(date.getTime() - 1);
      return date;
    } catch {
      return null;
    }
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export type ResolvedCallRange = { since: Date; until: Date };

export function resolveCallRange(
  input: { since: string; until?: string | undefined },
  now: Date,
): { ok: true; range: ResolvedCallRange } | { ok: false; error: string } {
  const since = parseBound(input.since, "start");
  if (!since) return { ok: false, error: "since must be YYYY-MM-DD or an ISO timestamp" };
  const until = input.until !== undefined ? parseBound(input.until, "end") : now;
  if (!until) return { ok: false, error: "until must be YYYY-MM-DD or an ISO timestamp" };
  if (since.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, error: "since is in the future" };
  }
  if (until.getTime() < since.getTime()) {
    return { ok: false, error: "until is before since" };
  }
  if (until.getTime() > now.getTime() + 36 * 60 * 60 * 1000) {
    return { ok: false, error: "until is too far in the future" };
  }
  const lookback = daysBetween(shopDate(since), shopDate(now));
  if (lookback > CALL_LOG_MAX_LOOKBACK_DAYS) {
    return {
      ok: false,
      error: `since is older than ${CALL_LOG_MAX_LOOKBACK_DAYS} days`,
    };
  }
  return { ok: true, range: { since, until } };
}

export type CallLogCursor = { page: number; index: number };

export function encodeCallCursor(state: CallLogCursor & { q: string }): string {
  return Buffer.from(
    JSON.stringify({ v: 1, q: state.q, page: state.page, index: state.index }),
    "utf8",
  ).toString("base64url");
}

export function decodeCallCursor(value: string, fingerprint: string): CallLogCursor | null {
  try {
    const json = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!json || typeof json !== "object") return null;
    const record = json as Record<string, unknown>;
    if (record["v"] !== 1 || record["q"] !== fingerprint) return null;
    const page = record["page"];
    const index = record["index"];
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 10_000)
      return null;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > CALL_LOG_PER_PAGE
    ) {
      return null;
    }
    return { page, index };
  } catch {
    return null;
  }
}
