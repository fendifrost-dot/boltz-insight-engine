import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secretEqual, secretStatus } from "./env.server.ts";
import {
  BOT_API_HEADER,
  BOT_DAILY_SMS_CAP_PER_NUMBER,
  BOT_DUPLICATE_BODY_WINDOW_MS,
  authorizeBotRequest,
  botActor,
  botIdempotencyKey,
  classifyIdempotencyHit,
  evaluateSendGates,
  isSendableE164,
  normalizeEmail,
  parseInboundSince,
  resolveStartLeadSource,
  screenOutboundText,
  type SendGateInput,
} from "./bot-api.policy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, "../../routes/api/public/bot.ts"), "utf8");
const serverSource = readFileSync(join(here, "bot-api.server.ts"), "utf8");
const outboundSource = readFileSync(join(here, "outbound.server.ts"), "utf8");
const ownerSource = readFileSync(join(here, "../../lib/lead-inbox.functions.ts"), "utf8");
const policySource = readFileSync(join(here, "bot-api.policy.ts"), "utf8");

const SECRET = "bot-api-test-secret";

function requestWith(
  headers: Record<string, string>,
  url = "https://boltz.example/api/public/bot",
): Request {
  return new Request(url, { method: "POST", headers });
}

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

test("missing BOT_API_SECRET is 503 and a wrong header is 401", async () => {
  const missing = authorizeBotRequest(requestWith({ [BOT_API_HEADER]: SECRET }), undefined);
  assert.equal(missing?.status, 503);
  const missingBody = await missing?.json();
  assert.equal(missingBody.error, "Bot API secret not configured");
  assert.equal(JSON.stringify(missingBody).includes(SECRET), false);

  const wrong = authorizeBotRequest(requestWith({ [BOT_API_HEADER]: "not-the-secret" }), SECRET);
  assert.equal(wrong?.status, 401);
  const wrongBody = await wrong?.text();
  assert.equal(wrongBody?.includes(SECRET), false);
  assert.equal(wrongBody?.includes("not-the-secret"), false);
});

test("the bot header authorizes and Authorization Bearer does not", () => {
  assert.equal(
    authorizeBotRequest(requestWith({ [BOT_API_HEADER]: `  ${SECRET}  ` }), SECRET),
    null,
  );
  const bearer = authorizeBotRequest(requestWith({ authorization: `Bearer ${SECRET}` }), SECRET);
  assert.equal(bearer?.status, 401);

  const query = authorizeBotRequest(
    requestWith({}, `https://boltz.example/api/public/bot?secret=${SECRET}`),
    SECRET,
  );
  assert.equal(query?.status, 401);
});

test("secretEqual is value-exact across different lengths and does not throw", () => {
  assert.equal(secretEqual(SECRET, SECRET), true);
  assert.equal(secretEqual(SECRET, `${SECRET} `), false);
  assert.equal(secretEqual(SECRET, SECRET.slice(0, -1)), false);
  assert.equal(secretEqual("", SECRET), false);
  assert.equal(secretEqual("short", "a-much-longer-secret-value"), false);
});

test("secret comparison hashes before timingSafeEqual", () => {
  assert.match(policySource, /secretEqual\(presented, configuredSecret\)/);
  const envSource = readFileSync(join(here, "env.server.ts"), "utf8");
  const compare = envSource.slice(envSource.indexOf("export function secretEqual"));
  assert.match(compare, /createHash\("sha256"\)/);
  assert.match(compare, /timingSafeEqual/);
  assert.doesNotMatch(compare, /a\.length !== b\.length/);
});

test("BOT_API_SECRET is reported as configured or missing, never the value", () => {
  const previous = process.env["BOT_API_SECRET"];
  process.env["BOT_API_SECRET"] = SECRET;
  try {
    const row = secretStatus().find((item) => item.name === "BOT_API_SECRET");
    assert.equal(row?.configured, true);
    assert.equal(row?.masked, null);
    assert.equal(JSON.stringify(row).includes(SECRET), false);
  } finally {
    if (previous === undefined) delete process.env["BOT_API_SECRET"];
    else process.env["BOT_API_SECRET"] = previous;
  }
});

test("opted-out and STOP block a new text", () => {
  const optedOut = evaluateSendGates(allowInput({ consentStatus: "opted_out" }));
  assert.deepEqual(optedOut, { kind: "block", status: 403, reason: "Lead has opted out of texts" });

  const stop = evaluateSendGates(allowInput({ latestInboundBody: "STOP" }));
  assert.equal(stop.kind, "block");
  if (stop.kind === "block") assert.equal(stop.status, 403);

  const normal = evaluateSendGates(allowInput({ latestInboundBody: "Can you look at my car?" }));
  assert.equal(normal.kind, "allow");
});

test("a retry is a duplicate and does not send again", () => {
  assert.equal(
    evaluateSendGates(allowInput({ idempotencyKeyAlreadyUsed: true, consentStatus: "opted_out" }))
      .kind,
    "duplicate",
  );
  assert.equal(
    evaluateSendGates(allowInput({ identicalBodyWithinWindow: true, outboundCountInWindow: 50 }))
      .kind,
    "duplicate",
  );
  assert.equal(
    evaluateSendGates(allowInput({ latestInboundBody: "STOP", identicalBodyWithinWindow: false }))
      .kind,
    "block",
  );
});

test("daily cap blocks a new text and still allows a retry", () => {
  const capped = evaluateSendGates(
    allowInput({ outboundCountInWindow: BOT_DAILY_SMS_CAP_PER_NUMBER }),
  );
  assert.deepEqual(capped, {
    kind: "block",
    status: 429,
    reason: "Daily SMS cap reached for this number",
  });
  assert.equal(
    evaluateSendGates(allowInput({ outboundCountInWindow: BOT_DAILY_SMS_CAP_PER_NUMBER - 1 })).kind,
    "allow",
  );
  assert.equal(
    evaluateSendGates(
      allowInput({
        outboundCountInWindow: BOT_DAILY_SMS_CAP_PER_NUMBER,
        idempotencyKeyAlreadyUsed: true,
      }),
    ).kind,
    "duplicate",
  );
});

test("phone and thread mismatches use the owner send block reasons", () => {
  assert.equal(evaluateSendGates(allowInput({ leadPhoneE164: null })).kind, "block");
  const mismatch = evaluateSendGates(allowInput({ threadPhoneE164: "+13125550199" }));
  assert.deepEqual(mismatch, {
    kind: "block",
    status: 409,
    reason: "Lead phone and thread phone disagree — send blocked",
  });
  const expected = evaluateSendGates(allowInput({ expectedPhoneE164: "+13125550198" }));
  assert.equal(expected.kind, "block");
  if (expected.kind === "block") {
    assert.equal(
      expected.reason,
      "Destination phone does not match the visible conversation — send blocked",
    );
  }
  const foreign = evaluateSendGates(
    allowInput({ threadLeadId: "lead-1", requestedLeadId: "lead-2" }),
  );
  assert.equal(foreign.kind, "block");
  if (foreign.kind === "block") {
    assert.equal(foreign.reason, "Thread does not belong to the selected lead — send blocked");
  }
});

test("idempotency keys are namespaced and identical bodies share a window bucket", () => {
  const now = 1_700_000_000_000 - (1_700_000_000_000 % BOT_DUPLICATE_BODY_WINDOW_MS);
  const keyed = botIdempotencyKey({
    botName: "shop-inbox",
    clientKey: "lead-42-touch",
    phoneE164: "+13125550100",
    text: "Hello",
    nowMs: now,
    windowMs: BOT_DUPLICATE_BODY_WINDOW_MS,
  });
  assert.equal(keyed, "bot:shop-inbox:lead-42-touch");
  assert.equal(
    botIdempotencyKey({
      botName: "other-bot",
      clientKey: "lead-42-touch",
      phoneE164: "+13125550100",
      text: "Different",
      nowMs: now,
      windowMs: BOT_DUPLICATE_BODY_WINDOW_MS,
    }),
    "bot:other-bot:lead-42-touch",
  );

  const first = botIdempotencyKey({
    botName: "shop-inbox",
    clientKey: undefined,
    phoneE164: "+13125550100",
    text: "Same text",
    nowMs: now,
    windowMs: BOT_DUPLICATE_BODY_WINDOW_MS,
  });
  const retry = botIdempotencyKey({
    botName: "shop-inbox",
    clientKey: undefined,
    phoneE164: "+13125550100",
    text: "Same text",
    nowMs: now + BOT_DUPLICATE_BODY_WINDOW_MS - 1,
    windowMs: BOT_DUPLICATE_BODY_WINDOW_MS,
  });
  const later = botIdempotencyKey({
    botName: "shop-inbox",
    clientKey: undefined,
    phoneE164: "+13125550100",
    text: "Same text",
    nowMs: now + BOT_DUPLICATE_BODY_WINDOW_MS,
    windowMs: BOT_DUPLICATE_BODY_WINDOW_MS,
  });
  assert.equal(first, retry);
  assert.notEqual(first, later);
  assert.equal(first.includes("Same text"), false);
});

test("outbound wording and length use the owner validator", () => {
  assert.equal(screenOutboundText("Hi, this is Boltz Automotive. Reply STOP to opt out.").ok, true);
  const blocked = screenOutboundText("We guarantee the repair.");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /Blocked by outbound policy validation/);
  const long = screenOutboundText("x".repeat(481));
  assert.equal(long.ok, false);
});

test("phone, email, source, and since parsers reject unsafe input", () => {
  assert.equal(isSendableE164("+13125550100"), true);
  assert.equal(isSendableE164("3125550100"), false);
  assert.equal(isSendableE164("+1312"), false);
  assert.equal(normalizeEmail("  Ada@Example.com "), "ada@example.com");
  assert.equal(normalizeEmail("a%@example.com"), null);
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.deepEqual(resolveStartLeadSource(undefined), { ok: true, source: "bot_outbound" });
  assert.deepEqual(resolveStartLeadSource("facebook_lead_ads_manual"), {
    ok: true,
    source: "facebook_lead_ads_manual",
  });
  assert.equal(resolveStartLeadSource("yelp;drop").ok, false);

  const now = Date.parse("2026-10-06T15:00:00Z");
  assert.equal(parseInboundSince("2026-10-06T14:00:00Z", now).ok, true);
  assert.equal(parseInboundSince("yesterday", now).ok, false);
  assert.equal(parseInboundSince("2026-01-01T00:00:00Z", now).ok, false);
});

test("actor is explicitly a bot", () => {
  assert.equal(botActor("shop-inbox"), "bot:shop-inbox");
});

test("an idempotency key is only a retry on the same thread", () => {
  assert.equal(classifyIdempotencyHit(null, "thread-1"), "none");
  assert.equal(classifyIdempotencyHit("thread-1", "thread-1"), "same-thread");
  assert.equal(classifyIdempotencyHit("thread-9", "thread-1"), "other-thread");
});

test("the route checks the bot secret before any send or read work", () => {
  const authAt = routeSource.indexOf("authorizeBotRequest(");
  const deniedAt = routeSource.indexOf("if (denied) return denied");
  const workAt = routeSource.indexOf("bot-api.server");
  assert.ok(authAt >= 0 && deniedAt > authAt && workAt > deniedAt);
  assert.equal(routeSource.includes("CRON_SECRET"), false);
  assert.equal(routeSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(routeSource.includes("console.error"), true);
  assert.equal(routeSource.includes(BOT_API_HEADER), false);
});

test("send checks idempotency, opt-out, and wording before writing or texting", () => {
  const handle = serverSource.slice(
    serverSource.indexOf("async function handleSend"),
    serverSource.indexOf("async function resolveSendTarget"),
  );
  assert.ok(handle.indexOf("screenOutboundText(") < handle.indexOf("resolveSendTarget("));
  assert.ok(handle.indexOf("evaluateSendGates(") < handle.indexOf('from("leads")'));
  assert.ok(handle.indexOf('decision.kind === "duplicate"') < handle.indexOf('from("leads")'));
  assert.ok(handle.indexOf('decision.kind === "block"') < handle.indexOf('from("leads")'));
  assert.ok(
    handle.indexOf('idempotencyHit === "other-thread"') < handle.indexOf("await sendOutbound("),
  );
  assert.ok(handle.includes("eventMetadata: { bot_name: data.botName }"));
  assert.ok(handle.includes("botActor(data.botName)"));
  assert.equal(serverSource.includes("CRON_SECRET"), false);
  assert.equal(serverSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false);

  const keyAt = outboundSource.indexOf("findMessageByIdempotencyKey(");
  const smsAt = outboundSource.indexOf("sendSms(");
  assert.ok(keyAt >= 0 && smsAt > keyAt, "a reused idempotency key must return before RingCentral");
});

test("staff send routes still require communications.send and do not accept the bot secret", () => {
  assert.match(ownerSource, /requireCapability\(context, "communications.send"\)/);
  assert.equal(ownerSource.includes("BOT_API_SECRET"), false);
  assert.equal(ownerSource.includes(BOT_API_HEADER), false);
});
