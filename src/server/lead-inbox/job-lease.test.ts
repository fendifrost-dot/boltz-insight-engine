import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTEMPTS_EXHAUSTED_LAST_ERROR,
  CALL_OUT_RESERVE_MS,
  INBOUND_AUTO_REPLY_WINDOW_MS,
  JOB_LEASE_MS,
  LEASE_EXHAUSTED_LAST_ERROR,
  LOCAL_JOB_RESERVE_MS,
  decideClaim,
  describeXaiError,
  errorText,
  failureUpdate,
  inboundAutoReplyAllowed,
  inboundMayCallOut,
  planInboundHandling,
  planStaleDrain,
  processingLeaseExpired,
  replyTextFromAgentRaw,
  reserveForJob,
  shouldWriteOptOut,
} from "./job-lease.ts";

const NOW = new Date("2026-10-13T16:00:00.000Z");
const FRESH = new Date(NOW.getTime() - 60_000).toISOString();
const STALE = new Date(NOW.getTime() - INBOUND_AUTO_REPLY_WINDOW_MS - 1).toISOString();
const EXPIRED_LOCK = new Date(NOW.getTime() - JOB_LEASE_MS - 1).toISOString();
const LIVE_LOCK = new Date(NOW.getTime() - 30_000).toISOString();

function inboundJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "processing",
    job_type: "process_inbound",
    attempts: 1,
    max_attempts: 5,
    locked_at: EXPIRED_LOCK,
    run_after: "2026-08-26T16:57:43.000Z",
    created_at: STALE,
    payload: { body: "hello", provider_created_at: STALE },
    ...overrides,
  };
}

test("a live processing lease is not reclaimed", () => {
  assert.equal(processingLeaseExpired(LIVE_LOCK, NOW), false);
  assert.deepEqual(
    decideClaim(
      {
        status: "processing",
        attempts: 1,
        max_attempts: 5,
        locked_at: LIVE_LOCK,
        run_after: FRESH,
      },
      NOW,
    ),
    { action: "skip" },
  );
});

test("an expired processing lease is reclaimed until attempts are exhausted", () => {
  assert.equal(processingLeaseExpired(EXPIRED_LOCK, NOW), true);
  assert.equal(processingLeaseExpired(null, NOW), true);
  assert.equal(
    decideClaim(
      {
        status: "processing",
        attempts: 1,
        max_attempts: 5,
        locked_at: EXPIRED_LOCK,
        run_after: STALE,
      },
      NOW,
    ).action,
    "claim_stale",
  );
  assert.deepEqual(
    decideClaim(
      {
        status: "processing",
        attempts: 5,
        max_attempts: 5,
        locked_at: null,
        run_after: STALE,
      },
      NOW,
    ),
    { action: "expire", reason: LEASE_EXHAUSTED_LAST_ERROR },
  );
});

test("the lease boundary is inclusive at JOB_LEASE_MS", () => {
  const exactly = new Date(NOW.getTime() - JOB_LEASE_MS).toISOString();
  const justInside = new Date(NOW.getTime() - JOB_LEASE_MS + 1).toISOString();
  assert.equal(processingLeaseExpired(exactly, NOW), true);
  assert.equal(processingLeaseExpired(justInside, NOW), false);
});

test("pending jobs are claimed when due and expired when attempts are already spent", () => {
  assert.equal(
    decideClaim(
      {
        status: "pending",
        attempts: 2,
        max_attempts: 5,
        locked_at: null,
        run_after: FRESH,
      },
      NOW,
    ).action,
    "claim_pending",
  );
  assert.equal(
    decideClaim(
      {
        status: "pending",
        attempts: 0,
        max_attempts: 5,
        locked_at: null,
        run_after: new Date(NOW.getTime() + 60_000).toISOString(),
      },
      NOW,
    ).action,
    "skip",
  );
  assert.deepEqual(
    decideClaim(
      {
        status: "pending",
        attempts: 5,
        max_attempts: 5,
        locked_at: null,
        run_after: FRESH,
      },
      NOW,
    ),
    { action: "expire", reason: ATTEMPTS_EXHAUSTED_LAST_ERROR },
  );
  assert.equal(
    decideClaim(
      {
        status: "succeeded",
        attempts: 1,
        max_attempts: 5,
        locked_at: null,
        run_after: FRESH,
      },
      NOW,
    ).action,
    "skip",
  );
});

test("failures retry with last_error until max attempts, then go dead", () => {
  assert.deepEqual(failureUpdate({ attempts: 1, max_attempts: 5 }), {
    status: "pending",
    backoffMs: 60_000,
    terminal: false,
  });
  assert.deepEqual(failureUpdate({ attempts: 2, max_attempts: 5 }), {
    status: "pending",
    backoffMs: 120_000,
    terminal: false,
  });
  assert.equal(failureUpdate({ attempts: 5, max_attempts: 5 }).status, "dead");
  assert.equal(failureUpdate({ attempts: 5, max_attempts: 5 }).terminal, true);
  assert.equal(failureUpdate({ attempts: 8, max_attempts: 5 }).backoffMs, 30 * 60_000);
  assert.deepEqual(failureUpdate({ attempts: 1, max_attempts: 5 }, { permanent: true }), {
    status: "dead",
    backoffMs: 60_000,
    terminal: true,
  });
});

test("error text never collapses an object to [object Object]", () => {
  assert.equal(errorText(new Error("xAI request timed out")), "xAI request timed out");
  assert.equal(errorText({ message: "database unavailable" }), "database unavailable");
  assert.equal(errorText({ code: "23505" }), "Job failed (23505)");
  assert.equal(errorText({}), "Job failed");
  assert.equal(errorText(null), "Job failed");
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  assert.equal(describeXaiError(timeout).message, "xAI request timed out");
  assert.equal(describeXaiError(new Error("bad json")).message, "bad json");
});

test("inbound inside the 15 minute window may be answered", () => {
  const atWindow = new Date(NOW.getTime() - INBOUND_AUTO_REPLY_WINDOW_MS).toISOString();
  assert.equal(
    inboundAutoReplyAllowed({
      providerCreatedAt: FRESH,
      jobCreatedAt: STALE,
      now: NOW,
    }),
    true,
  );
  assert.equal(
    inboundAutoReplyAllowed({
      providerCreatedAt: atWindow,
      jobCreatedAt: STALE,
      now: NOW,
    }),
    true,
  );
  assert.equal(
    inboundAutoReplyAllowed({
      providerCreatedAt: new Date(NOW.getTime() + 5_000).toISOString(),
      jobCreatedAt: STALE,
      now: NOW,
    }),
    true,
  );
});

test("inbound older than 15 minutes never gets an automated reply, including STOP confirmation", () => {
  const staleHello = planInboundHandling({
    body: "Can I drop the car off tomorrow?",
    providerCreatedAt: STALE,
    jobCreatedAt: STALE,
    now: NOW,
    consentStatus: "unknown",
  });
  assert.equal(staleHello.autoReply, false);
  assert.equal(staleHello.sendOptOutConfirmation, false);
  assert.equal(staleHello.applyOptIn, false);
  assert.equal(staleHello.surfaceForHuman, true);

  const staleStop = planInboundHandling({
    body: "STOP",
    providerCreatedAt: STALE,
    jobCreatedAt: FRESH,
    now: NOW,
    consentStatus: "opted_in",
  });
  assert.equal(staleStop.applyOptOut, true);
  assert.equal(staleStop.sendOptOutConfirmation, false);
  assert.equal(staleStop.autoReply, false);
  assert.equal(staleStop.surfaceForHuman, true);

  const staleStartWhileOptedOut = planInboundHandling({
    body: "START",
    providerCreatedAt: STALE,
    jobCreatedAt: STALE,
    now: NOW,
    consentStatus: "opted_out",
  });
  assert.equal(staleStartWhileOptedOut.applyOptIn, false);
  assert.equal(staleStartWhileOptedOut.autoReply, false);
  assert.equal(staleStartWhileOptedOut.sendOptOutConfirmation, false);
});

test("a fresh opted-out number is not texted, and a fresh STOP still gets the confirmation", () => {
  const optedOut = planInboundHandling({
    body: "What time are you open?",
    providerCreatedAt: FRESH,
    jobCreatedAt: FRESH,
    now: NOW,
    consentStatus: "opted_out",
  });
  assert.equal(optedOut.autoReply, false);
  assert.equal(optedOut.sendOptOutConfirmation, false);
  assert.equal(optedOut.surfaceForHuman, false);

  const freshStop = planInboundHandling({
    body: "Stop.",
    providerCreatedAt: FRESH,
    jobCreatedAt: FRESH,
    now: NOW,
    consentStatus: "opted_in",
  });
  assert.equal(freshStop.applyOptOut, true);
  assert.equal(freshStop.sendOptOutConfirmation, true);
  assert.equal(freshStop.autoReply, false);

  const freshStart = planInboundHandling({
    body: "START",
    providerCreatedAt: FRESH,
    jobCreatedAt: FRESH,
    now: NOW,
    consentStatus: "opted_out",
  });
  assert.equal(freshStart.applyOptIn, true);
  assert.equal(freshStart.autoReply, true);
});

test("a missing timestamp does not allow an automated reply", () => {
  assert.equal(
    inboundAutoReplyAllowed({
      providerCreatedAt: null,
      jobCreatedAt: "not-a-date",
      now: NOW,
    }),
    false,
  );
  const plan = planInboundHandling({
    body: "hello",
    providerCreatedAt: "not-a-date",
    jobCreatedAt: "also-not",
    now: NOW,
    consentStatus: "opted_in",
  });
  assert.equal(plan.autoReply, false);
  assert.equal(plan.surfaceForHuman, true);
});

test("provider time wins over a fresh job row when the text itself is old", () => {
  const plan = planInboundHandling({
    body: "hello",
    providerCreatedAt: STALE,
    jobCreatedAt: FRESH,
    now: NOW,
    consentStatus: "opted_in",
  });
  assert.equal(plan.autoReply, false);
  assert.equal(inboundMayCallOut(inboundJob({ created_at: FRESH }), NOW), false);
});

test("STOP is written unless a newer consent change already opted them back in", () => {
  assert.equal(
    shouldWriteOptOut({
      consentStatus: "unknown",
      consentUpdatedAt: null,
      inboundAtMs: Date.parse(STALE),
    }),
    true,
  );
  assert.equal(
    shouldWriteOptOut({
      consentStatus: "opted_out",
      consentUpdatedAt: FRESH,
      inboundAtMs: Date.parse(STALE),
    }),
    false,
  );
  assert.equal(
    shouldWriteOptOut({
      consentStatus: "opted_in",
      consentUpdatedAt: FRESH,
      inboundAtMs: Date.parse(STALE),
    }),
    false,
  );
  assert.equal(
    shouldWriteOptOut({
      consentStatus: "opted_in",
      consentUpdatedAt: STALE,
      inboundAtMs: Date.parse(FRESH),
    }),
    true,
  );
});

test("a stale drain reclaims expired inbound work and does not call out", () => {
  const live = inboundJob({
    id: "live",
    locked_at: LIVE_LOCK,
    created_at: FRESH,
    payload: { body: "hello", provider_created_at: FRESH },
  });
  const exhausted = inboundJob({ id: "spent", attempts: 5, max_attempts: 5 });
  const backlog = inboundJob({ id: "old" });
  const plan = planStaleDrain([live, exhausted, backlog], NOW);
  assert.deepEqual(plan.reclaim, ["old"]);
  assert.deepEqual(plan.expire, ["spent"]);
  assert.deepEqual(plan.skip, ["live"]);
  assert.deepEqual(plan.suppressAutoReply, ["old"]);
  assert.equal(reserveForJob(backlog, NOW), LOCAL_JOB_RESERVE_MS);
  assert.equal(reserveForJob(live, NOW), CALL_OUT_RESERVE_MS);
});

test("a stored send decision can be replayed only from explicit send JSON", () => {
  assert.equal(
    replyTextFromAgentRaw({
      content: JSON.stringify({ action: "send", reply_text: "See you at 10." }),
    }),
    "See you at 10.",
  );
  assert.equal(
    replyTextFromAgentRaw({ content: JSON.stringify({ action: "escalate", reply_text: "nope" }) }),
    null,
  );
  assert.equal(replyTextFromAgentRaw({ content: "not json" }), null);
  assert.equal(replyTextFromAgentRaw(null), null);
});

test("the worker queries stale processing rows and gates sends on the plan", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)));
  const store = readFileSync(join(root, "store.server.ts"), "utf8");
  const jobs = readFileSync(join(root, "jobs.server.ts"), "utf8");
  const grok = readFileSync(join(root, "grok.server.ts"), "utf8");
  const protocol = readFileSync(join(root, "../mcp/protocol.ts"), "utf8");
  const policy = readFileSync(join(root, "bot-api.policy.ts"), "utf8");

  assert.match(store, /\.eq\("status", "processing"\)/);
  assert.match(store, /decideClaim/);
  assert.match(store, /LEASE_EXPIRED_LAST_ERROR/);
  assert.match(jobs, /planInboundHandling/);
  assert.match(jobs, /handling\.sendOptOutConfirmation/);
  assert.match(jobs, /surfaceStaleInbound/);
  assert.match(jobs, /releaseClaimedJob/);
  assert.match(grok, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(grok, /describeXaiError/);
  assert.match(protocol, /export const TEXTING_START_HOUR = 8;/);
  assert.match(protocol, /export const TEXTING_END_HOUR = 21;/);
  assert.match(policy, /export const BOT_DAILY_SMS_CAP_PER_NUMBER = 20;/);
});
