import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("outbound.server marks ambiguous outcomes instead of fail after provider acceptance path", () => {
  const source = readFileSync(join(repoRoot, "src/server/lead-inbox/outbound.server.ts"), "utf8");
  assert.match(source, /providerAccepted/);
  assert.match(source, /requiresReview: true/);
  const persistCatch = source.slice(source.indexOf("catch (persistError)"));
  assert.doesNotMatch(persistCatch.slice(0, 800), /failOutboundSendReservation/);
});

test("outbound.server only calls failOutboundSendReservation for confirmed rejection path", () => {
  const source = readFileSync(join(repoRoot, "src/server/lead-inbox/outbound.server.ts"), "utf8");
  const failIndex = source.lastIndexOf("await failOutboundSendReservation");
  const ambiguousIndex = source.lastIndexOf("await markSendAmbiguous");
  assert.ok(failIndex >= 0 && ambiguousIndex >= 0);
  assert.match(source.slice(failIndex - 200, failIndex), /ambiguous/);
});

test("owner outbound uses stable client operation id instead of Date.now", () => {
  const source = readFileSync(join(repoRoot, "src/lib/lead-inbox.functions.ts"), "utf8");
  assert.match(source, /operationId: z\.string\(\)\.uuid\(\)/);
  assert.match(source, /owner:\$\{thread\.id\}:\$\{data\.operationId\}/);
  assert.doesNotMatch(source, /Date\.now\(\)/);
});

test("hardening migration fences completion on claim generation and marks stale sending ambiguous", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260828140000_outbound_reservation_hardening.sql"),
    "utf8",
  );
  assert.match(migration, /claim_generation = _expected_claim_generation/);
  assert.match(migration, /Expired sending lease; provider outcome unknown/);
  assert.match(migration, /retryable = true/);
});
