import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(name: string): string {
  return stripComments(readFileSync(join(here, name), "utf8"));
}

const forbidden = /sendOutbound|enqueueJob|processJobs|sendSms|createWebhookSubscription/;

test("email and Google Ads intake never enqueue or send a message", () => {
  for (const name of [
    "email-ingest.server.ts",
    "google-ads-ingest.server.ts",
    "health.server.ts",
    "gmail.server.ts",
  ]) {
    assert.doesNotMatch(read(name), forbidden, name);
  }
  const route = stripComments(
    readFileSync(join(here, "../../routes/api/public/cron/ingest-leads.ts"), "utf8"),
  );
  assert.doesNotMatch(route, forbidden);
  assert.match(route, /mode=dry-run writes nothing|mode !== "dry-run"/);
  assert.match(route, /suppress_first_touch|dryRun: mode === "dry-run"/);
});

test("reconciliation records a duplicate-page failure without failing the subscribed page", () => {
  const reconcile = stripComments(
    readFileSync(join(here, "../meta-leads/reconcile.server.ts"), "utf8"),
  );
  assert.match(reconcile, /summary\.pageErrors\.push\(message\)/);
  assert.match(reconcile, /checkName: "duplicate_page"/);
  assert.match(reconcile, /page\.reason === "subscribed"/);
  assert.match(reconcile, /DUPLICATE_LEADGEN_PAGE_ID/);
});

test("the intake migration schedules a cron only by copying an existing command", () => {
  const sql = readFileSync(
    join(here, "../../../supabase/migrations/20261001190000_email_intake_receipts.sql"),
    "utf8",
  );
  assert.match(sql, /email_intake_receipts/);
  assert.match(sql, /suppress_first_touch boolean NOT NULL DEFAULT true/);
  assert.match(sql, /cron\.schedule/);
  assert.match(sql, /lead-intake/);
  assert.match(sql, /reconcile-messages/);
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9]/);
  assert.doesNotMatch(sql, /INSERT INTO public\.leads/i);
});
