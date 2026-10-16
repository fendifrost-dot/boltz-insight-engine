// Read-only RingCentral call log for MCP. Never sends SMS.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ToolOutcome } from "../mcp/protocol.ts";
import {
  CALL_LOG_MAX_PAGES,
  CALL_LOG_PER_PAGE,
  CALL_LOG_TIME_ZONE,
  EXTENSION_FALLBACK_NOTE,
  READ_CALL_LOG_PERMISSION,
  READ_CALL_LOG_STEPS,
  callMatches,
  canonicalWeekday,
  decodeCallCursor,
  encodeCallCursor,
  isAppCallLogDenial,
  mapCallRecord,
  publicCall,
  resolveCallRange,
  scopesOmitReadCallLog,
  summarizeCalls,
  userCallLogSteps,
  type CallDirection,
  type CallLogPageQuery,
  type MappedCall,
  type RawCallRecord,
  type WeekdayName,
} from "./call-log.ts";
import { readSecret } from "./env.server.ts";
import { normalizeLeadPhone } from "./phone.ts";
import { grantedScopes, readCallLogPage, RingCentralHttpError } from "./ringcentral.server.ts";

export type CallLogPage = {
  records: RawCallRecord[];
  hasNext: boolean;
};

export type CallLogDeps = {
  shopNumber: string | null;
  scopes: string[] | null;
  fetchPage: (query: CallLogPageQuery) => Promise<CallLogPage>;
};

const argsSchema = z
  .object({
    since: z.string().min(1).max(40),
    until: z.string().min(1).max(40).optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    phone: z.string().min(1).max(40).optional(),
    weekday: z.string().min(1).max(20).optional(),
    line: z.enum(["any", "main"]).optional(),
    mode: z.enum(["list", "summary"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();

function invalid(error: z.ZodError): ToolOutcome {
  return {
    resultCode: "invalid",
    isError: true,
    value: {
      error: "Invalid arguments",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
  };
}

function failed(resultCode: string, value: Record<string, unknown>): ToolOutcome {
  return { resultCode, isError: true, value };
}

function safeText(value: string): string {
  return value
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-jwt]")
    .replace(/\+?\d{7,}/g, "[redacted]")
    .slice(0, 300);
}

function permissionOutcome(input: {
  error: string;
  permission: string;
  steps: string;
  grantedScopes: readonly string[];
  errorCode?: string | null;
}): ToolOutcome {
  const value: Record<string, unknown> = {
    ok: false,
    error: input.error,
    permission: input.permission,
    steps: input.steps,
  };
  if (input.errorCode) value["errorCode"] = input.errorCode;
  if (input.grantedScopes.length > 0) value["grantedScopes"] = [...input.grantedScopes];
  return failed("forbidden", value);
}

function denialOutcome(error: RingCentralHttpError, scopes: readonly string[]): ToolOutcome {
  if (isAppCallLogDenial(error)) {
    return permissionOutcome({
      error: "The RingCentral app is missing the ReadCallLog permission.",
      permission: READ_CALL_LOG_PERMISSION,
      steps: READ_CALL_LOG_STEPS,
      grantedScopes: scopes,
      errorCode: error.errorCode,
    });
  }
  if (error.status === 403) {
    return permissionOutcome({
      error: "This RingCentral user is not allowed to read the call log.",
      permission: error.permissionNames[0] ?? "FullCompanyCallLog",
      steps: userCallLogSteps(error.permissionNames),
      grantedScopes: scopes,
      errorCode: error.errorCode,
    });
  }
  if (error.status === 429) {
    return failed("rate_limited", {
      ok: false,
      error: "RingCentral call log rate limit reached. Retry in a minute.",
    });
  }
  if (error.status === 400) {
    return failed("invalid", {
      ok: false,
      error: "RingCentral rejected the call log filters.",
      errorCode: error.errorCode,
    });
  }
  return failed(error.status >= 500 ? "unavailable" : "error", {
    ok: false,
    error: safeText(error.message),
  });
}

function isFallbackDenial(error: unknown): error is RingCentralHttpError {
  if (!(error instanceof RingCentralHttpError)) return false;
  if (error.status === 404) return true;
  if (error.status !== 403) return false;
  return !isAppCallLogDenial(error);
}

function digitsForRingCentral(phone: string): string {
  return phone.replace(/\D/g, "");
}

async function liveCallLogDeps(): Promise<CallLogDeps> {
  return {
    shopNumber: normalizeLeadPhone(readSecret("RINGCENTRAL_FROM_NUMBER")),
    scopes: await grantedScopes(),
    fetchPage: (query) => readCallLogPage(query),
  };
}

export async function callLogTool(
  args: unknown,
  now: Date,
  deps?: CallLogDeps,
): Promise<ToolOutcome> {
  try {
    const resolved = deps ?? (await liveCallLogDeps());
    return await executeCallLog(args, now, resolved);
  } catch (error) {
    if (error instanceof RingCentralHttpError) return denialOutcome(error, []);
    const message = error instanceof Error ? error.message : "RingCentral call log failed";
    return failed("unavailable", { ok: false, error: safeText(message) });
  }
}

async function executeCallLog(args: unknown, now: Date, deps: CallLogDeps): Promise<ToolOutcome> {
  const parsed = argsSchema.safeParse(args ?? {});
  if (!parsed.success) return invalid(parsed.error);

  const mode = parsed.data.mode ?? "list";
  const line = parsed.data.line ?? "any";
  const limit = parsed.data.limit ?? (mode === "summary" ? 25 : 50);
  let weekday: WeekdayName | null = null;
  if (parsed.data.weekday !== undefined) {
    weekday = canonicalWeekday(parsed.data.weekday);
    if (!weekday) {
      return failed("invalid", {
        ok: false,
        error: "weekday must be a weekday name, such as Friday",
      });
    }
  }

  let phone: string | null = null;
  if (parsed.data.phone !== undefined) {
    phone = normalizeLeadPhone(parsed.data.phone);
    if (!phone)
      return failed("invalid", { ok: false, error: "phone must be a US number or E.164" });
  }

  if (line === "main" && !deps.shopNumber) {
    return failed("unavailable", {
      ok: false,
      error: "RINGCENTRAL_FROM_NUMBER is not configured, so the main line cannot be selected.",
    });
  }

  const range = resolveCallRange(
    {
      since: parsed.data.since,
      ...(parsed.data.until !== undefined ? { until: parsed.data.until } : {}),
    },
    now,
  );
  if (!range.ok) return failed("invalid", { ok: false, error: range.error });

  const direction: CallDirection | null = parsed.data.direction ?? null;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        since: range.range.since.toISOString(),
        until: range.range.until.toISOString(),
        direction,
        phone,
        weekday,
        line,
        mode,
      }),
      "utf8",
    )
    .digest("hex");

  let page = 1;
  let index = 0;
  if (parsed.data.cursor !== undefined) {
    const cursor = decodeCallCursor(parsed.data.cursor, fingerprint);
    if (!cursor) {
      return failed("invalid", { ok: false, error: "cursor does not match these filters" });
    }
    page = cursor.page;
    index = cursor.index;
  }

  if (scopesOmitReadCallLog(deps.scopes)) {
    return permissionOutcome({
      error: "The RingCentral app is missing the ReadCallLog permission.",
      permission: READ_CALL_LOG_PERMISSION,
      steps: READ_CALL_LOG_STEPS,
      grantedScopes: deps.scopes ?? [],
    });
  }

  const phoneNumber =
    phone && (!deps.shopNumber || phone !== deps.shopNumber)
      ? digitsForRingCentral(phone)
      : line === "main" && deps.shopNumber
        ? digitsForRingCentral(deps.shopNumber)
        : null;

  const queryBase: Omit<CallLogPageQuery, "level" | "page"> = {
    dateFrom: range.range.since.toISOString(),
    dateTo: range.range.until.toISOString(),
    perPage: CALL_LOG_PER_PAGE,
  };
  if (direction) queryBase.direction = direction === "inbound" ? "Inbound" : "Outbound";
  if (phoneNumber) queryBase.phoneNumber = phoneNumber;

  let level: CallLogPageQuery["level"] = "account";
  let note: string | undefined;
  let opened = false;
  const seen = new Set<string>();
  const matches: MappedCall[] = [];
  let scanned = 0;
  let pages = 0;
  let truncated = false;
  let nextCursor: string | null = null;
  let rateLimited = false;

  const pull = async (
    target: CallLogPageQuery["level"],
    pageNumber: number,
  ): Promise<CallLogPage> => {
    const query: CallLogPageQuery = { ...queryBase, level: target, page: pageNumber };
    return deps.fetchPage(query);
  };

  try {
    while (pages < CALL_LOG_MAX_PAGES) {
      let batch: CallLogPage;
      try {
        batch = await pull(level, page);
      } catch (error) {
        if (!opened && level === "account" && isFallbackDenial(error)) {
          level = "extension";
          note = EXTENSION_FALLBACK_NOTE;
          batch = await pull(level, page);
        } else if (
          error instanceof RingCentralHttpError &&
          error.status === 429 &&
          matches.length > 0
        ) {
          rateLimited = true;
          truncated = true;
          nextCursor = encodeCallCursor({ q: fingerprint, page, index: 0 });
          break;
        } else {
          throw error;
        }
      }
      opened = true;
      pages += 1;
      const records = batch.records;
      if (index > records.length) index = records.length;
      let fresh = 0;
      let stop = false;
      for (let i = index; i < records.length; i += 1) {
        const raw = records[i];
        if (!raw) continue;
        const id = raw.id?.trim();
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        fresh += 1;
        scanned += 1;
        const mapped = mapCallRecord(raw, deps.shopNumber);
        if (
          !mapped ||
          !callMatches(mapped, { direction, phone, weekday, shopNumber: deps.shopNumber, line })
        ) {
          continue;
        }
        matches.push(mapped);
        if (mode === "list" && matches.length >= limit) {
          const nextIndex = i + 1;
          if (nextIndex < records.length) {
            nextCursor = encodeCallCursor({ q: fingerprint, page, index: nextIndex });
            truncated = true;
          } else if (batch.hasNext) {
            nextCursor = encodeCallCursor({ q: fingerprint, page: page + 1, index: 0 });
            truncated = true;
          }
          stop = true;
          break;
        }
      }
      if (stop) break;
      if (records.length > 0 && fresh === 0 && index === 0) break;
      if (!batch.hasNext) break;
      page += 1;
      index = 0;
      if (pages >= CALL_LOG_MAX_PAGES) {
        truncated = true;
        nextCursor = encodeCallCursor({ q: fingerprint, page, index: 0 });
        break;
      }
    }
  } catch (error) {
    if (error instanceof RingCentralHttpError) return denialOutcome(error, deps.scopes ?? []);
    throw error;
  }

  const value: Record<string, unknown> = {
    ok: true,
    mode,
    timeZone: CALL_LOG_TIME_ZONE,
    source: level,
    since: range.range.since.toISOString(),
    until: range.range.until.toISOString(),
    scanned,
    truncated,
    nextCursor,
  };
  if (deps.shopNumber) value["shopLine"] = deps.shopNumber;
  if (note) value["note"] = note;
  if (rateLimited) value["rateLimited"] = true;
  if (mode === "list") {
    value["calls"] = matches.map((call) => publicCall(call));
  } else {
    const summary = summarizeCalls(matches, limit);
    value["groups"] = summary.groups;
    value["groupCount"] = summary.groupCount;
  }
  return { resultCode: "ok", isError: false, value };
}
