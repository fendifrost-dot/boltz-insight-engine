import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOT_DAILY_SMS_CAP_PER_NUMBER,
  evaluateSendGates,
  type SendGateInput,
} from "../lead-inbox/bot-api.policy.ts";
import { validateLifecycleEvidence } from "../../lib/lifecycle-transitions.ts";
import { resolveTransitionActorKind } from "../../lib/lifecycle-transitions.ts";
import {
  QUIET_HOURS_REASON,
  executeMcpSend,
  hashEquals,
  isWithinTextingHours,
  publicSecretFlags,
  sha256Hex,
  summarizeToolArgs,
  zonedHour,
} from "./protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));

function allowInput(overrides: Partial<SendGateInput> = {}): SendGateInput {
  return {
    consentStatus: "unknown",
    latestInboundBody: null,
    leadPhoneE164: "+13125550100",
    threadPhoneE164: "+13125550100",
    expectedPhoneE164: null,
    threadLeadId: "lead-1",
    requestedLeadId: null,
    idempotencyKeyAlreadyUsed: false,
    identicalBodyWithinWindow: false,
    outboundCountInWindow: 0,
    dailyCap: BOT_DAILY_SMS_CAP_PER_NUMBER,
    ...overrides,
  };
}

const insideHours = new Date("2026-01-15T15:00:00.000Z");
const ninePmWinter = new Date("2026-01-15T03:00:00.000Z");
const eightFiftyNinePmWinter = new Date("2026-01-15T02:59:00.000Z");
const eightAmWinter = new Date("2026-01-15T14:00:00.000Z");
const sevenFiftyNineAmWinter = new Date("2026-01-15T13:59:00.000Z");
const ninePmSummer = new Date("2026-07-15T02:00:00.000Z");
const eightFiftyNinePmSummer = new Date("2026-07-15T01:59:00.000Z");

test("texting hours are 8:00 AM through 8:59 PM America/Chicago", () => {
  assert.equal(zonedHour(eightAmWinter), 8);
  assert.equal(zonedHour(sevenFiftyNineAmWinter), 7);
  assert.equal(zonedHour(eightFiftyNinePmWinter), 20);
  assert.equal(zonedHour(ninePmWinter), 21);
  assert.equal(isWithinTextingHours(insideHours), true);
  assert.equal(isWithinTextingHours(eightAmWinter), true);
  assert.equal(isWithinTextingHours(eightFiftyNinePmWinter), true);
  assert.equal(isWithinTextingHours(sevenFiftyNineAmWinter), false);
  assert.equal(isWithinTextingHours(ninePmWinter), false);
  assert.equal(zonedHour(ninePmSummer), 21);
  assert.equal(isWithinTextingHours(ninePmSummer), false);
  assert.equal(isWithinTextingHours(eightFiftyNinePmSummer), true);
});

test("hash comparison is exact and does not throw on bad digests", () => {
  const digest = sha256Hex("mcp-test-token-value-01");
  assert.equal(digest.length, 64);
  assert.equal(hashEquals(digest, digest), true);
  assert.equal(hashEquals(digest, sha256Hex("mcp-test-token-value-02")), false);
  assert.equal(hashEquals("zz", digest), false);
  assert.equal(hashEquals("", ""), false);
  assert.equal(hashEquals("0".repeat(64), "f".repeat(64)), false);
});

test("audit summaries keep lengths and drop message bodies and phone numbers", () => {
  const text = "Hi there, the car is ready for pickup tomorrow.";
  const summary = summarizeToolArgs({
    phone: "+13125550100",
    email: "ada@example.com",
    name: "Ada Example",
    text,
    notes: "left a voicemail",
    botName: "lead-follow-up",
    idempotencyKey: "touch-13125550100-1",
    leadId: "00000000-0000-4000-8000-000000000001",
  });
  const encoded = JSON.stringify(summary);
  assert.equal(encoded.includes("3125550100"), false);
  assert.equal(encoded.includes("car is ready"), false);
  assert.equal(encoded.includes("voicemail"), false);
  assert.equal(encoded.includes("ada@example.com"), false);
  assert.equal(encoded.includes("Ada Example"), false);
  assert.equal(summary["textLength"], text.length);
  assert.equal(summary["notesLength"], "left a voicemail".length);
  assert.equal(summary["phonePresent"], true);
  assert.equal(summary["botName"], "lead-follow-up");
  assert.equal(summary["idempotencyKey"], "touch-[redacted]-1");
  for (const key of ["phone", "email", "text", "body", "name", "notes", "from", "service"]) {
    assert.equal(Object.hasOwn(summary, key), false);
  }
});

test("secret flags expose configured or missing and never a masked value", () => {
  const flags = publicSecretFlags([
    { name: "RINGCENTRAL_FROM_NUMBER", configured: true, masked: "+1******0100" },
    { name: "BOT_API_SECRET", configured: false, masked: null },
  ]);
  assert.deepEqual(flags, [
    { name: "RINGCENTRAL_FROM_NUMBER", configured: true },
    { name: "BOT_API_SECRET", configured: false },
  ]);
  assert.equal(JSON.stringify(flags).includes("0100"), false);
});

test("the bot send gates still block opt-out and the daily cap and still treat a retry as a duplicate", () => {
  const optedOut = evaluateSendGates(allowInput({ consentStatus: "opted_out" }));
  assert.deepEqual(optedOut, { kind: "block", status: 403, reason: "Lead has opted out of texts" });

  const stop = evaluateSendGates(allowInput({ latestInboundBody: "STOP" }));
  assert.equal(stop.kind, "block");
  if (stop.kind === "block") assert.equal(stop.status, 403);

  const capped = evaluateSendGates(
    allowInput({ outboundCountInWindow: BOT_DAILY_SMS_CAP_PER_NUMBER }),
  );
  assert.equal(capped.kind, "block");
  if (capped.kind === "block") assert.equal(capped.status, 429);

  assert.equal(
    evaluateSendGates(
      allowInput({
        idempotencyKeyAlreadyUsed: true,
        consentStatus: "opted_out",
        outboundCountInWindow: BOT_DAILY_SMS_CAP_PER_NUMBER,
      }),
    ).kind,
    "duplicate",
  );
});

test("MCP send maps opt-out, the cap, and an idempotent retry from the bot send path", async () => {
  const base = {
    botName: "lead-follow-up",
    idempotencyKey: "follow-up-example-1",
    text: "Hi, this is Boltz Automotive. Reply STOP to opt out.",
    phone: "+13125550100",
  };

  const opted = await executeMcpSend({
    agentName: "lead-follow-up",
    input: base,
    now: insideHours,
    dispatch: async () =>
      Response.json(
        { ok: false, duplicate: false, reason: "Lead has opted out of texts" },
        { status: 403 },
      ),
  });
  assert.equal(opted.resultCode, "opted_out");
  assert.equal(opted.isError, true);
  assert.equal(JSON.stringify(opted.value).includes("13125550100"), false);

  const capped = await executeMcpSend({
    agentName: "lead-follow-up",
    input: base,
    now: insideHours,
    dispatch: async () =>
      Response.json(
        { ok: false, duplicate: false, reason: "Daily SMS cap reached for this number" },
        { status: 429 },
      ),
  });
  assert.equal(capped.resultCode, "rate_limited");
  assert.equal(capped.isError, true);

  const duplicate = await executeMcpSend({
    agentName: "lead-follow-up",
    input: base,
    now: insideHours,
    dispatch: async () => Response.json({ ok: true, duplicate: true, reason: null }),
  });
  assert.equal(duplicate.resultCode, "duplicate");
  assert.equal(duplicate.isError, false);
});

test("quiet hours, a mismatched bot name, and a missing idempotency key never dispatch", async () => {
  let calls = 0;
  const dispatch = async (request: Request) => {
    calls += 1;
    const body = (await request.json()) as { idempotencyKey?: string; action?: string };
    assert.equal(body.action, "send");
    assert.equal(body.idempotencyKey, "follow-up-example-1");
    return Response.json({ ok: true, duplicate: false });
  };
  const input = {
    botName: "lead-follow-up",
    idempotencyKey: "follow-up-example-1",
    text: "Hi, this is Boltz Automotive. Reply STOP to opt out.",
    phone: "+13125550100",
  };

  const quiet = await executeMcpSend({
    agentName: "lead-follow-up",
    input,
    now: ninePmWinter,
    dispatch,
  });
  assert.equal(quiet.resultCode, "quiet_hours");
  assert.equal(quiet.isError, true);
  assert.equal((quiet.value as { error: string }).error, QUIET_HOURS_REASON);
  assert.equal(calls, 0);

  const mismatch = await executeMcpSend({
    agentName: "lead-follow-up",
    input: { ...input, botName: "chief-of-staff" },
    now: insideHours,
    dispatch,
  });
  assert.equal(mismatch.resultCode, "forbidden");
  assert.equal(calls, 0);

  const missingKey = await executeMcpSend({
    agentName: "lead-follow-up",
    input: { botName: "lead-follow-up", text: input.text, phone: input.phone },
    now: insideHours,
    dispatch,
  });
  assert.equal(missingKey.resultCode, "invalid");
  assert.equal(calls, 0);

  const sent = await executeMcpSend({
    agentName: "lead-follow-up",
    input,
    now: insideHours,
    dispatch,
  });
  assert.equal(sent.resultCode, "ok");
  assert.equal(calls, 1);
});

test("send is wired to the bot handler and not a second SMS path", () => {
  const tools = readFileSync(join(here, "tools.server.ts"), "utf8");
  const send = tools.slice(
    tools.indexOf('case "boltz_send_sms"'),
    tools.indexOf('case "boltz_update_lead"'),
  );
  assert.match(send, /executeMcpSend/);
  assert.match(send, /handleBotRequest/);
  assert.equal(tools.includes("sendOutbound"), false);
  assert.equal(tools.includes("BOT_API_SECRET"), false);
  assert.equal(tools.includes("SUPABASE_SERVICE_ROLE_KEY"), false);

  const match = tools.match(/const STAFF_EVIDENCE = \[([\s\S]*?)\] as const/);
  assert.ok(match?.[1]);
  const bases = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((item) => item[1] ?? "");
  assert.equal(bases.includes("payment_record"), false);
  for (const basis of bases) {
    const result = validateLifecycleEvidence({
      actor: "staff",
      evidence: {
        basis: basis as "staff_observation",
        assertedBy: "00000000-0000-4000-8000-000000000001",
      },
    });
    assert.equal(result.ok, true, basis);
  }
  assert.equal(resolveTransitionActorKind("staff:mcp:lead-follow-up"), "staff");
});
