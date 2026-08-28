import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("webhook uses atomic enqueue_inbound_message_job RPC", () => {
  const source = readFileSync(
    join(repoRoot, "src/routes/api/public/ringcentral/webhook.ts"),
    "utf8",
  );
  assert.match(source, /enqueueInboundMessageJob\(/);
  assert.doesNotMatch(source, /enqueueJob\(/);
});

test("reconciliation uses the same atomic inbound enqueue path", () => {
  const source = readFileSync(join(repoRoot, "src/server/lead-inbox/cron.server.ts"), "utf8");
  assert.match(source, /enqueueInboundMessageJob\(/);
  assert.doesNotMatch(source, /from\("messages"\)[\s\S]*provider_message_id[\s\S]*continue/);
});

test("processInbound propagates correlation identity through agent runs and outbound sends", () => {
  const source = readFileSync(join(repoRoot, "src/server/lead-inbox/jobs.server.ts"), "utf8");
  assert.match(source, /correlation_id: correlationId/);
  assert.match(source, /correlationId,/);
  assert.match(source, /logCorrelation\(/);
});

test("correlation migration defines deterministic derive and service-role-only RPC grants", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260828110000_correlation_outbound_idempotency.sql"),
    "utf8",
  );
  assert.match(migration, /derive_inbound_correlation_id/);
  assert.match(migration, /enqueue_inbound_message_job/);
  assert.match(migration, /reserve_outbound_send/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enqueue_inbound_message_job/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enqueue_inbound_message_job/);
});
