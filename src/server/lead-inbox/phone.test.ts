import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INBOUND_PHONE_NEEDS_REVIEW,
  LEAD_PHONE_E164,
  decideInboundPhone,
  normalizeLeadPhone,
  stampInboundNeedsReview,
} from "./phone.ts";
import { decideClaim, failureUpdate } from "./job-lease.ts";

const NOW = new Date("2026-10-14T16:10:51.000Z");

test("normalizeLeadPhone accepts a US 10-digit shop number as +1 E.164", () => {
  assert.equal(normalizeLeadPhone("3125550100"), "+13125550100");
  assert.equal(normalizeLeadPhone("(312) 555-0100"), "+13125550100");
  assert.equal(normalizeLeadPhone("312.555.0100"), "+13125550100");
  assert.equal(LEAD_PHONE_E164.test("+13125550100"), true);
});

test("normalizeLeadPhone keeps an already-E.164 number", () => {
  assert.equal(normalizeLeadPhone("+13125550100"), "+13125550100");
  assert.equal(normalizeLeadPhone("+1 312 555 0100"), "+13125550100");
  assert.equal(normalizeLeadPhone("13125550100"), "+13125550100");
  assert.equal(normalizeLeadPhone("+447911123456"), "+447911123456");
});

test("normalizeLeadPhone rejects empty and null", () => {
  assert.equal(normalizeLeadPhone(null), null);
  assert.equal(normalizeLeadPhone(undefined), null);
  assert.equal(normalizeLeadPhone(""), null);
  assert.equal(normalizeLeadPhone("   "), null);
});

test("normalizeLeadPhone rejects garbage that cannot satisfy leads_phone_e164_format", () => {
  for (const raw of [
    "anonymous",
    "not-a-phone",
    "555",
    "+123",
    "+0123456789",
    "+",
    "++",
    "1234567",
  ]) {
    assert.equal(normalizeLeadPhone(raw), null, raw);
  }
});

test("an unnormalizable inbound is a permanent needs_review skip and creates no lead phone", () => {
  for (const raw of [null, undefined, "", "   ", "anonymous", "555", 3125550100]) {
    const decision = decideInboundPhone(raw);
    assert.equal(decision.action, "skip");
    if (decision.action !== "skip") continue;
    assert.equal(decision.permanent, true);
    assert.equal(decision.disposition, "needs_review");
    assert.equal(decision.skipped, true);
    assert.equal(decision.lastError, INBOUND_PHONE_NEEDS_REVIEW);
    assert.match(decision.lastError, /skipped/);
    assert.match(decision.lastError, /needs_review/);
    assert.match(decision.lastError, /No lead was created/);
  }

  const accepted = decideInboundPhone("3125550100");
  assert.deepEqual(accepted, { action: "accept", phone: "+13125550100" });
});

test("a skipped inbound fails on attempt 1 and is not claimed again", () => {
  const decision = decideInboundPhone("anonymous");
  assert.equal(decision.action, "skip");
  const outcome = failureUpdate({ attempts: 1, max_attempts: 5 }, { permanent: true });
  assert.deepEqual(outcome, { status: "dead", backoffMs: 60_000, terminal: true });
  assert.equal(
    decideClaim(
      {
        status: outcome.status,
        attempts: 1,
        max_attempts: 5,
        locked_at: null,
        run_after: NOW.toISOString(),
      },
      NOW,
    ).action,
    "skip",
  );
});

test("the review stamp keeps the inbound payload and marks it skipped", () => {
  const stamped = stampInboundNeedsReview({
    provider_message_id: "rc-1",
    from: "anonymous",
    body: "hello",
  });
  assert.equal(stamped["from"], "anonymous");
  assert.equal(stamped["body"], "hello");
  assert.equal(stamped["provider_message_id"], "rc-1");
  assert.equal(stamped["disposition"], "needs_review");
  assert.equal(stamped["skipped"], true);
  assert.equal(stamped["skip_reason"], "unnormalizable_phone");
  assert.deepEqual(stampInboundNeedsReview(null), {
    disposition: "needs_review",
    skipped: true,
    skip_reason: "unnormalizable_phone",
  });
});

test("process_inbound skips a bad phone before creating a lead and the worker continues", () => {
  const source = readFileSync(new URL("./jobs.server.ts", import.meta.url), "utf8");
  const worker = source.slice(
    source.indexOf("export async function processJobs"),
    source.indexOf("async function runJob"),
  );
  const branch = worker.slice(worker.indexOf("error instanceof PermanentJobError"));
  const keptGoing = branch.slice(0, branch.indexOf("continue;"));
  assert.match(keptGoing, /permanent: true/);
  assert.match(keptGoing, /disposition: error\.disposition/);
  assert.equal(keptGoing.includes("break;"), false);

  const inbound = source.slice(source.indexOf("export async function processInbound"));
  const decide = inbound.indexOf("decideInboundPhone(payload.from)");
  const create = inbound.indexOf("getOrCreateLeadThread");
  assert.ok(decide !== -1 && create !== -1 && decide < create);
});

test("lead creation checks the phone before insert", () => {
  const source = readFileSync(new URL("./store.server.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getOrCreateLeadThread");
  const end = source.indexOf("export async function addEvent");
  const body = source.slice(start, end);
  const guard = body.indexOf("decideInboundPhone");
  const insert = body.indexOf(".insert(");
  assert.ok(guard !== -1 && insert !== -1 && guard < insert);
  assert.match(body, /PermanentJobError/);
  assert.match(body, /if \(decision\.action === "skip"\)/);
});
