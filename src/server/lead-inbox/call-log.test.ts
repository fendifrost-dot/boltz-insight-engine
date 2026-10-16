import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeToolArgs, toolDefinition, toolsForScopes } from "../mcp/protocol.ts";
import {
  CALL_LOG_MAX_LOOKBACK_DAYS,
  EXTENSION_FALLBACK_NOTE,
  READ_CALL_LOG_STEPS,
  callLogRequestPath,
  classifyCallResult,
  parseRingCentralError,
  type CallLogPageQuery,
  type RawCallRecord,
} from "./call-log.ts";
import { callLogTool, type CallLogDeps } from "./call-log.server.ts";
import { RingCentralHttpError } from "./ringcentral.server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-10-16T18:00:00.000Z");
const SHOP = "+17085754555";
const VENDOR = "+17085550111";
const OTHER = "+17085550222";
const OPTED_OUT = "+17085550999";

function voice(partial: RawCallRecord & { id: string; startTime: string }): RawCallRecord {
  return {
    type: "Voice",
    direction: "Inbound",
    result: "Accepted",
    duration: 45,
    from: { phoneNumber: VENDOR, name: "Paint Vendor" },
    to: { phoneNumber: SHOP, name: "Boltz Automotive" },
    ...partial,
  };
}

function deps(fetchPage: CallLogDeps["fetchPage"], extra?: Partial<CallLogDeps>): CallLogDeps {
  return {
    shopNumber: SHOP,
    scopes: ["SMS", "ReadMessages", "ReadCallLog"],
    fetchPage,
    ...extra,
  };
}

function pages(records: RawCallRecord[][]): CallLogDeps["fetchPage"] {
  return async (query) => {
    const batch = records[query.page - 1] ?? [];
    return { records: batch, hasNext: query.page < records.length };
  };
}

test("call results map to answered, missed, or voicemail and keep other results distinct", () => {
  assert.equal(classifyCallResult("Accepted"), "answered");
  assert.equal(classifyCallResult("Call connected"), "answered");
  assert.equal(classifyCallResult("Missed"), "missed");
  assert.equal(classifyCallResult("No Answer"), "missed");
  assert.equal(classifyCallResult("Hang Up"), "missed");
  assert.equal(classifyCallResult("Voicemail"), "voicemail");
  assert.equal(classifyCallResult("In Progress"), "other");
});

test("the call log request is a voice detail GET and does not ask for recordings", () => {
  const path = callLogRequestPath({
    level: "account",
    dateFrom: "2026-01-01T06:00:00.000Z",
    dateTo: "2026-10-16T18:00:00.000Z",
    page: 2,
    perPage: 5000,
    direction: "Inbound",
    phoneNumber: "+17085550111",
  });
  const url = new URL(path, "https://platform.ringcentral.com");
  assert.equal(url.pathname, "/restapi/v1.0/account/~/call-log");
  assert.equal(url.searchParams.get("view"), "Detailed");
  assert.equal(url.searchParams.get("type"), "Voice");
  assert.equal(url.searchParams.get("showBlocked"), "true");
  assert.equal(url.searchParams.get("direction"), "Inbound");
  assert.equal(url.searchParams.get("phoneNumber"), "17085550111");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("perPage"), "1000");
  assert.equal(url.searchParams.has("recordingType"), false);
  assert.equal(url.searchParams.has("withRecording"), false);
  assert.equal(path.includes("+"), false);

  const extension = new URL(
    callLogRequestPath({
      level: "extension",
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-01-02T00:00:00.000Z",
      page: 1,
      perPage: 50,
    }),
    "https://platform.ringcentral.com",
  );
  assert.equal(extension.pathname, "/restapi/v1.0/account/~/extension/~/call-log");
});

test("a documented ReadCallLog refusal names the permission", () => {
  const parsed = parseRingCentralError(
    JSON.stringify({
      errorCode: "InsufficientPermissions",
      message:
        "In order to call this API endpoint, application needs to have [ReadCallLog] permission",
      errors: [
        {
          errorCode: "CMN-401",
          message:
            "In order to call this API endpoint, application needs to have [ReadCallLog] permission",
          permissionName: "ReadCallLog",
        },
      ],
      permissionName: "ReadCallLog",
    }),
  );
  assert.equal(parsed.errorCode, "CMN-401");
  assert.deepEqual(parsed.permissionNames, ["ReadCallLog"]);
});

test("Chicago Friday mornings stay Friday mornings across daylight saving time", async () => {
  const seen: CallLogPageQuery[] = [];
  const result = await callLogTool(
    {
      since: "2026-01-01",
      weekday: "Friday",
      line: "main",
      direction: "inbound",
      mode: "list",
    },
    NOW,
    deps(async (query) => {
      seen.push(query);
      return {
        records: [
          voice({ id: "winter", startTime: "2026-01-02T15:00:00.000Z" }),
          voice({
            id: "summer",
            startTime: "2026-07-03T14:00:00.000Z",
            from: { phoneNumber: VENDOR, name: "Paint Vendor" },
          }),
          voice({ id: "thursday", startTime: "2026-01-01T15:00:00.000Z" }),
          voice({
            id: "evening",
            startTime: "2026-01-02T23:30:00.000Z",
            result: "Voicemail",
            duration: 12,
          }),
        ],
        hasNext: false,
      };
    }),
  );
  assert.equal(result.isError, false);
  const value = result.value as {
    calls: { id: string; at: string; weekday: string; timeOfDay: string; result: string }[];
  };
  assert.deepEqual(
    value.calls.map((call) => [call.id, call.at, call.weekday, call.timeOfDay, call.result]),
    [
      ["winter", "2026-01-02T09:00:00-06:00", "Friday", "morning", "answered"],
      ["summer", "2026-07-03T09:00:00-05:00", "Friday", "morning", "answered"],
      ["evening", "2026-01-02T17:30:00-06:00", "Friday", "evening", "voicemail"],
    ],
  );
  assert.equal(seen[0]?.dateFrom, "2026-01-01T06:00:00.000Z");
  assert.equal(seen[0]?.dateTo, NOW.toISOString());
  assert.equal(seen[0]?.direction, "Inbound");
  assert.equal(seen[0]?.phoneNumber, "17085754555");
  assert.equal(seen[0]?.level, "account");
});

test("since can reach back a year and rejects an older date", async () => {
  const ok = await callLogTool(
    { since: "2025-10-09", mode: "list", limit: 1 },
    NOW,
    deps(pages([[]])),
  );
  assert.equal(ok.isError, false, JSON.stringify(ok.value));
  const tooOld = await callLogTool(
    { since: "2025-10-08" },
    NOW,
    deps(async () => {
      throw new Error("should not fetch");
    }),
  );
  assert.equal(tooOld.resultCode, "invalid");
  assert.match(JSON.stringify(tooOld.value), new RegExp(String(CALL_LOG_MAX_LOOKBACK_DAYS)));
});

test("list pagination resumes without putting the phone number in the cursor", async () => {
  const queries: CallLogPageQuery[] = [];
  const records = [
    [
      voice({ id: "a", startTime: "2026-10-09T14:00:00.000Z" }),
      voice({ id: "b", startTime: "2026-10-02T14:00:00.000Z" }),
    ],
    [voice({ id: "c", startTime: "2026-09-25T14:00:00.000Z", result: "Missed", duration: 0 })],
  ];
  const first = await callLogTool(
    { since: "2026-01-01", limit: 1, phone: "(708) 555-0111" },
    NOW,
    deps(async (query) => {
      queries.push(query);
      return pages(records)(query);
    }),
  );
  const firstValue = first.value as { calls: { id: string }[]; nextCursor: string };
  assert.equal(firstValue.calls[0]?.id, "a");
  assert.equal(firstValue.nextCursor.includes("7085550111"), false);
  assert.equal(firstValue.nextCursor.includes(VENDOR), false);
  assert.equal(queries[0]?.phoneNumber, "17085550111");

  const second = await callLogTool(
    { since: "2026-01-01", limit: 1, phone: VENDOR, cursor: firstValue.nextCursor },
    NOW,
    deps(async (query) => {
      queries.push(query);
      return pages(records)(query);
    }),
  );
  const secondValue = second.value as { calls: { id: string; from: string }[]; nextCursor: string };
  assert.equal(secondValue.calls[0]?.id, "b");
  assert.equal(secondValue.calls[0]?.from, VENDOR);

  const third = await callLogTool(
    { since: "2026-01-01", limit: 1, phone: VENDOR, cursor: secondValue.nextCursor },
    NOW,
    deps(pages(records)),
  );
  const thirdValue = third.value as {
    calls: { id: string; result: string; durationSeconds: number }[];
    nextCursor: string | null;
  };
  assert.equal(thirdValue.calls[0]?.id, "c");
  assert.equal(thirdValue.calls[0]?.result, "missed");
  assert.equal(thirdValue.calls[0]?.durationSeconds, 0);
  assert.equal(thirdValue.nextCursor, null);
});

test("summary groups a recurring Friday caller and still shows an opted-out number", async () => {
  const result = await callLogTool(
    { since: "2026-01-01", weekday: "fri", mode: "summary", line: "main" },
    NOW,
    deps(
      pages([
        [
          voice({ id: "f1", startTime: "2026-01-02T15:00:00.000Z", result: "Accepted" }),
          voice({ id: "f2", startTime: "2026-01-09T15:30:00.000Z", result: "Missed", duration: 0 }),
          voice({
            id: "f3",
            startTime: "2026-01-16T16:00:00.000Z",
            result: "Voicemail",
            duration: 20,
          }),
          voice({
            id: "once",
            startTime: "2026-01-02T20:00:00.000Z",
            from: { phoneNumber: OTHER, name: "Parts Desk" },
            result: "Accepted",
          }),
          voice({ id: "thursday", startTime: "2026-01-01T15:00:00.000Z" }),
          voice({
            id: "opted",
            startTime: "2026-02-06T15:00:00.000Z",
            from: { phoneNumber: OPTED_OUT, name: "Stopped Customer" },
            result: "Accepted",
          }),
          {
            ...voice({ id: "recorded", startTime: "2026-02-13T15:00:00.000Z" }),
            recording: { contentUri: "https://recording.example/secret-audio" },
            uri: "https://platform.ringcentral.com/secret-record",
          } as RawCallRecord,
        ],
      ]),
    ),
  );
  assert.equal(result.resultCode, "ok");
  const value = result.value as {
    groups: {
      phone: string;
      callerIdName: string | null;
      count: number;
      weekdays: string[];
      timesOfDay: string[];
      hours: number[];
      firstSeen: string;
      lastSeen: string;
      answered: number;
      missed: number;
      voicemail: number;
    }[];
  };
  const encoded = JSON.stringify(value);
  assert.equal(encoded.includes("secret"), false);
  assert.equal(encoded.includes("recording"), false);
  assert.equal(encoded.includes("contentUri"), false);
  const vendor = value.groups[0];
  assert.equal(vendor?.phone, VENDOR);
  assert.equal(vendor?.callerIdName, "Paint Vendor");
  assert.equal(vendor?.count, 4);
  assert.deepEqual(vendor?.weekdays, ["Friday"]);
  assert.deepEqual(vendor?.timesOfDay, ["morning"]);
  assert.deepEqual(vendor?.hours, [9, 10]);
  assert.equal(vendor?.answered, 2);
  assert.equal(vendor?.missed, 1);
  assert.equal(vendor?.voicemail, 1);
  assert.equal(vendor?.firstSeen, "2026-01-02T09:00:00-06:00");
  assert.equal(vendor?.lastSeen, "2026-02-13T09:00:00-06:00");
  assert.equal(
    value.groups.some((group) => group.phone === OPTED_OUT),
    true,
  );
  assert.equal(
    value.groups.some((group) => group.phone === OTHER),
    true,
  );
});

test("a missing ReadCallLog scope does not call RingCentral and tells Fendi what to enable", async () => {
  let called = 0;
  const result = await callLogTool(
    { since: "2026-01-01" },
    NOW,
    deps(
      async () => {
        called += 1;
        return { records: [], hasNext: false };
      },
      { scopes: ["SMS", "ReadMessages"] },
    ),
  );
  assert.equal(called, 0);
  assert.equal(result.resultCode, "forbidden");
  const value = result.value as { permission: string; steps: string; grantedScopes: string[] };
  assert.equal(value.permission, "ReadCallLog");
  assert.equal(value.steps, READ_CALL_LOG_STEPS);
  assert.match(value.steps, /developers\.ringcentral\.com\/my-account\.html#\/applications/);
  assert.match(value.steps, /RINGCENTRAL_JWT/);
  assert.match(value.steps, /ReadCallRecording/);
  assert.deepEqual(value.grantedScopes, ["SMS", "ReadMessages"]);
});

test("account call log user denial falls back to the extension log", async () => {
  const levels: string[] = [];
  const result = await callLogTool(
    { since: "2026-01-01", limit: 5 },
    NOW,
    deps(async (query) => {
      levels.push(query.level);
      if (query.level === "account") {
        throw new RingCentralHttpError(
          "/restapi/v1.0/account/~/call-log",
          403,
          JSON.stringify({
            errorCode: "InsufficientPermissions",
            message:
              "In order to call this API endpoint, one of the following permissions [FullCompanyCallLog] have to be granted to the authorized user.",
            errors: [
              {
                errorCode: "CMN-408",
                permissionName: "FullCompanyCallLog",
              },
            ],
          }),
        );
      }
      return {
        records: [voice({ id: "ext-1", startTime: "2026-10-09T14:00:00.000Z" })],
        hasNext: false,
      };
    }),
  );
  assert.deepEqual(levels, ["account", "extension"]);
  assert.equal(result.resultCode, "ok");
  const value = result.value as { source: string; note?: string; calls: { id: string }[] };
  assert.equal(value.source, "extension");
  assert.equal(value.note, EXTENSION_FALLBACK_NOTE);
  assert.equal(value.calls[0]?.id, "ext-1");
});

test("an application ReadCallLog refusal does not fall back and does not send", async () => {
  const levels: string[] = [];
  const result = await callLogTool(
    { since: "2026-01-01" },
    NOW,
    deps(
      async (query) => {
        levels.push(query.level);
        throw new RingCentralHttpError(
          "/restapi/v1.0/account/~/call-log?phoneNumber=17085550111",
          403,
          JSON.stringify({
            errorCode: "InsufficientPermissions",
            message:
              "In order to call this API endpoint, application needs to have [ReadCallLog] permission",
            errors: [{ errorCode: "CMN-401", permissionName: "ReadCallLog" }],
            permissionName: "ReadCallLog",
          }),
        );
      },
      { scopes: [] },
    ),
  );
  assert.deepEqual(levels, ["account"]);
  assert.equal(result.resultCode, "forbidden");
  const value = result.value as { steps: string; error: string };
  assert.match(value.error, /ReadCallLog/);
  assert.match(value.steps, /Do not paste the JWT/);
  assert.equal(JSON.stringify(value).includes("17085550111"), false);
});

test("call log audit summaries keep the weekday and drop the phone and cursor", () => {
  const summary = summarizeToolArgs({
    phone: VENDOR,
    cursor: `cursor-${VENDOR}`,
    since: "2026-01-01",
    weekday: "Friday",
    mode: "summary",
    line: "main",
    direction: "inbound",
  });
  const encoded = JSON.stringify(summary);
  assert.equal(encoded.includes("7085550111"), false);
  assert.equal(encoded.includes("cursor-"), false);
  assert.equal(summary["phonePresent"], true);
  assert.equal(summary["cursorPresent"], true);
  assert.equal(summary["weekday"], "Friday");
  assert.equal(summary["mode"], "summary");
  assert.equal(summary["line"], "main");
  assert.equal(summary["direction"], "inbound");
});

test("boltz_call_log is a read tool and the handler does not send", () => {
  const tool = toolDefinition("boltz_call_log");
  assert.equal(tool?.scope, "read");
  assert.match(tool?.description ?? "", /Does not send SMS/);
  assert.match(tool?.description ?? "", /Opted-out numbers are included/);
  const read = toolsForScopes(["read"]).map((item) => item.name);
  assert.equal(read.includes("boltz_call_log"), true);
  assert.equal(
    toolsForScopes(["send"]).some((item) => item.name === "boltz_call_log"),
    false,
  );

  const tools = readFileSync(join(here, "../mcp/tools.server.ts"), "utf8");
  const block = tools.slice(
    tools.indexOf('case "boltz_call_log"'),
    tools.indexOf('case "boltz_send_sms"'),
  );
  assert.match(block, /callLogTool/);
  assert.equal(block.includes("sendSms"), false);
  assert.equal(block.includes("executeMcpSend"), false);

  const server = readFileSync(join(here, "call-log.server.ts"), "utf8");
  assert.equal(server.includes("sendSms"), false);
  assert.equal(server.includes("opted_out"), false);
  assert.equal(server.includes("detectOptOut"), false);

  const adapter = readFileSync(join(here, "ringcentral.server.ts"), "utf8");
  const fn = adapter.slice(
    adapter.indexOf("export async function readCallLogPage"),
    adapter.indexOf("export async function listRecentMessages"),
  );
  assert.match(fn, /method:\s*"GET"/);
  assert.equal(/sendSms|a2p-sms|method:\s*"POST"/.test(fn), false);
  assert.match(fn, /callLogRequestPath/);
});
