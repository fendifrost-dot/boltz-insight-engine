import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  assert.match(source, /recovered/);
  assert.doesNotMatch(source, /\.or\(`locked_at\.is\.null/);
});

test("processJobs reports recovered stale leases", () => {
  const source = readFileSync(jobsPath, "utf8");
  assert.match(source, /recoveredStale/);
  assert.match(source, /const \{ jobs, recovered \} = await claimJobs/);
});

test("claim_message_jobs migration recovers stale processing leases atomically", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /create or replace function public\.claim_message_jobs/i);
  assert.match(sql, /status = 'processing'/i);
  assert.match(sql, /locked_at < _lease_cutoff/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /set search_path = public/i);
  assert.match(sql, /grant execute on function public\.claim_message_jobs[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.claim_message_jobs[\s\S]*from public, anon, authenticated/i);
});
