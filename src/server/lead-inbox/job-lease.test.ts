import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertJobLeaseRpcStatus } from "./job-lease.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const storePath = join(repoRoot, "src/server/lead-inbox/store.server.ts");
const jobsPath = join(repoRoot, "src/server/lead-inbox/jobs.server.ts");
const migrationPath = join(
  repoRoot,
  "supabase/migrations/20260828070000_claim_message_jobs_rpc.sql",
);

test("claimJobs uses atomic claim_message_jobs RPC with lease recovery", () => {
  const source = readFileSync(storePath, "utf8");
  assert.match(source, /rpc\("claim_message_jobs"/);
  assert.match(source, /expired_dead/);
  assert.match(source, /rpc\("complete_message_job"/);
  assert.match(source, /rpc\("fail_message_job"/);
  assert.match(source, /_expected_attempts: job\.attempts/);
  assert.doesNotMatch(source, /\.or\(`locked_at\.is\.null/);
});

test("processJobs reports recovered stale leases and lost lease fencing", () => {
  const source = readFileSync(jobsPath, "utf8");
  assert.match(source, /recoveredStale/);
  assert.match(source, /expiredDead/);
  assert.match(source, /lostLease/);
  assert.match(source, /JobLeaseLostError/);
  assert.match(source, /await completeJob\(job\)/);
});

test("claim_message_jobs migration enforces retry ceilings and lease fencing RPCs", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /attempts >= max_attempts/i);
  assert.match(sql, /attempts < max_attempts/i);
  assert.match(sql, /complete_message_job/i);
  assert.match(sql, /fail_message_job/i);
  assert.match(sql, /status = 'processing'/i);
  assert.match(sql, /attempts = _expected_attempts/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /set search_path = public/i);
  assert.match(sql, /grant execute on function public\.claim_message_jobs[\s\S]*to service_role/i);
});

test("assertJobLeaseRpcStatus rejects unexpected lease RPC payloads", () => {
  assert.throws(
    () => assertJobLeaseRpcStatus({ status: "lost_lease" }, ["completed"]),
    /Unexpected job lease RPC status/,
  );
  assert.equal(assertJobLeaseRpcStatus({ status: "completed" }, ["completed", "lost_lease"]), "completed");
});
