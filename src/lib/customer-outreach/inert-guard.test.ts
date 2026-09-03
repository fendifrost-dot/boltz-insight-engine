import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_OUTREACH_CHECKIN_ENABLED,
  CUSTOMER_OUTREACH_ENABLED,
  CUSTOMER_OUTREACH_SEND_ENABLED,
  CUSTOMER_OUTREACH_SQUARE_SYNC_ENABLED,
  assertOutreachSendAllowed,
} from "../../server/customer-outreach/flags.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "customer-outreach") continue;
      walkTsFiles(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

test("every outreach flag defaults to off", () => {
  assert.equal(CUSTOMER_OUTREACH_ENABLED, false);
  assert.equal(CUSTOMER_OUTREACH_SQUARE_SYNC_ENABLED, false);
  assert.equal(CUSTOMER_OUTREACH_SEND_ENABLED, false);
  assert.equal(CUSTOMER_OUTREACH_CHECKIN_ENABLED, false);
});

test("assertOutreachSendAllowed always throws in this proposal PR", () => {
  assert.throws(() => assertOutreachSendAllowed(), /cannot text customers/i);
});

test("live send and cron paths do not import customer-outreach", () => {
  const live = [
    join(repoRoot, "src/server/lead-inbox/outbound.server.ts"),
    join(repoRoot, "src/server/lead-inbox/jobs.server.ts"),
    join(repoRoot, "src/server/lead-inbox/cron.server.ts"),
    join(repoRoot, "src/routes/api/public/cron/process-jobs.ts"),
    join(repoRoot, "src/routes/api/public/cron/reconcile-messages.ts"),
    join(repoRoot, "src/routes/api/public/cron/renew-subscriptions.ts"),
    join(repoRoot, "src/lib/lead-inbox.functions.ts"),
  ];
  for (const file of live) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /customer-outreach/, file);
  }
});

test("customer-outreach module never calls sendOutbound", () => {
  const files = [
    ...walkTsFiles(join(repoRoot, "src/lib/customer-outreach")),
    ...walkTsFiles(join(repoRoot, "src/server/customer-outreach")),
  ];
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from\s+["'].*outbound/, file);
    assert.doesNotMatch(source, /\bsendOutbound\s*\(/, file);
    assert.doesNotMatch(source, /\bsendSms\s*\(/, file);
  }
});

test("proposed schema is not a live migration", () => {
  const migrations = readdirSync(join(repoRoot, "supabase/migrations"));
  for (const name of migrations) {
    assert.doesNotMatch(name, /outreach|square_order|service_due/i, name);
  }
});
