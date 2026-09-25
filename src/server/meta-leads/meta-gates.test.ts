import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// These modules reach Supabase/Graph on import, so ordering invariants are
// asserted statically (same approach as server-capability-gates.test.ts).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) =>
  readFileSync(join(repoRoot, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const webhook = read("src/routes/api/public/meta/webhook.ts");
const reconcileRoute = read("src/routes/api/public/cron/reconcile-meta-leads.ts");
const fns = read("src/lib/meta-leads.functions.ts");
const firstTouch = read("src/server/meta-leads/first-touch.server.ts");
const ingest = read("src/server/meta-leads/ingest.server.ts");
const env = read("src/server/meta-leads/env.server.ts");
const jobs = read("src/server/lead-inbox/jobs.server.ts");
const migration = readFileSync(
  join(repoRoot, "supabase/migrations/20260924180000_meta_lead_ads_ingestion.sql"),
  "utf8",
);

function block(source: string, start: string): string {
  const i = source.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const next = source.indexOf("\nasync function ", i + 1);
  const nextExport = source.indexOf("\nexport ", i + 1);
  const ends = [next, nextExport].filter((n) => n > 0);
  return source.slice(i, ends.length ? Math.min(...ends) : undefined);
}

test("webhook verifies X-Hub-Signature-256 over the raw body before parsing or storing", () => {
  const receive = block(webhook, "async function receive");
  const raw = receive.indexOf("request.text()");
  const verify = receive.indexOf("verifyMetaSignature(");
  const parse = receive.indexOf("JSON.parse(");
  const store = receive.indexOf("handleLeadgenEvents(");
  const received = receive.indexOf('"webhook_received"');
  assert.ok(raw >= 0 && verify > raw, "raw body must be read before verification");
  assert.ok(parse > verify, "JSON must not be parsed before the signature check");
  assert.ok(store > verify && received > verify, "nothing is persisted before the signature check");
  assert.match(receive, /Invalid signature[\s\S]*?status: 401/);
  assert.doesNotMatch(
    receive,
    /JSON\.stringify\(payload\)[\s\S]*verifyMetaSignature/,
    "no re-serialization",
  );
});

test("webhook distinguishes unconfigured (503) from bad signature (401) and bad handshake (403)", () => {
  const receive = block(webhook, "async function receive");
  assert.ok(receive.indexOf("status: 503") < receive.indexOf("status: 401"));
  const verify = block(webhook, "async function verify");
  assert.match(verify, /META_WEBHOOK_VERIFY_TOKEN[\s\S]*status: 503[\s\S]*status: 403/);
});

test("webhook persists receipts before any Graph fetch", () => {
  const handle = block(ingest, "export async function handleLeadgenEvents");
  assert.ok(handle.indexOf("recordReceipt(") < handle.indexOf("ingestMetaLead("));
  const ingestFn = block(ingest, "export async function ingestMetaLead");
  assert.ok(ingestFn.indexOf("recordReceipt(") < ingestFn.indexOf("getLead("));
});

test("receipts dedupe on meta_lead_id without overwriting the first ingestion method", () => {
  const receipt = block(ingest, "export async function recordReceipt");
  assert.match(receipt, /onConflict: "meta_lead_id", ignoreDuplicates: true/);
});

test("Grok is enqueued only after the durable ingested update is claimed", () => {
  const ingestFn = block(ingest, "export async function ingestMetaLead");
  const claim = ingestFn.indexOf('ingest_status: "ingested"');
  const claimedCheck = ingestFn.indexOf("(claimed ?? []).length === 0");
  const enqueue = ingestFn.indexOf('jobType: "process_meta_lead"');
  assert.ok(claim >= 0 && claimedCheck > claim && enqueue > claimedCheck);
  assert.match(
    ingestFn,
    /inboundProviderMessageId: `meta:\$\{args\.metaLeadId\}`/,
    "job is keyed per Meta lead",
  );
});

test("process_meta_lead runs through the shared job worker", () => {
  assert.match(jobs, /case "process_meta_lead"[\s\S]*processMetaLead\(job\)/);
});

test("reconcile cron authorizes the bearer before doing any work", () => {
  const run = block(reconcileRoute, "async function run");
  const auth = run.indexOf("authorizeCron(request)");
  assert.ok(auth >= 0);
  assert.ok(auth < run.indexOf("metaConfigError"));
  assert.ok(auth < run.indexOf("reconcileMetaLeads"));
});

test("every Meta server fn requires integrations.manage before touching server modules", () => {
  for (const name of [
    "getMetaHealthFn",
    "reconcileMetaNow",
    "importMetaLead",
    "subscribeMetaPage",
  ]) {
    const start = fns.indexOf(`export const ${name} = createServerFn`);
    assert.ok(start >= 0, `missing ${name}`);
    const next = fns.indexOf("\nexport const ", start + 1);
    const body = fns.slice(start, next > 0 ? next : undefined);
    const gate = body.indexOf('requireCapability(context, "integrations.manage")');
    const work = body.indexOf('await import("@/server/');
    assert.ok(gate >= 0, `${name} missing integrations.manage`);
    assert.ok(work > gate, `${name} must gate before loading server modules`);
  }
});

test("Meta integration never sends messages outside the existing outbound path", () => {
  assert.doesNotMatch(fns, /sendOutbound|sendSms/, "Meta server fns must not send");
  assert.doesNotMatch(ingest, /sendOutbound|sendSms/, "ingestion must not send");
  assert.doesNotMatch(
    firstTouch,
    /sendSms/,
    "first touch must use sendOutbound, not the raw provider",
  );
});

test("automated first touch requires the opt-in switch AND form SMS consent", () => {
  const allowed = firstTouch.indexOf(
    'const autoAllowed = autoFirstTouchEnabled() && lead.consent_status === "opted_in";',
  );
  const guard = firstTouch.indexOf("if (!autoAllowed)");
  const send = firstTouch.indexOf("sendOutbound({");
  assert.ok(
    allowed >= 0 && guard > allowed && send > guard,
    "send must sit behind the consent gate",
  );
  assert.ok(
    firstTouch.indexOf('"opted_out"') < send,
    "opted-out leads are skipped before any send",
  );
  assert.match(
    env,
    /META_AUTO_FIRST_TOUCH"\)\?\.toLowerCase\(\) === "enabled"/,
    "switch is off by default",
  );
});

test("migration: unique Meta lead id, RLS on, staff read-only, no anon", () => {
  assert.match(
    migration,
    /CONSTRAINT meta_lead_submissions_meta_lead_id_unique UNIQUE \(meta_lead_id\)/,
  );
  assert.match(migration, /ALTER TABLE public\.meta_lead_submissions ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /FOR SELECT TO authenticated USING \(public\.is_staff\(auth\.uid\(\)\)\)/,
  );
  assert.doesNotMatch(migration, /FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/i);
  assert.match(migration, /REVOKE ALL ON public\.meta_lead_submissions FROM anon/);
  assert.match(migration, /'WEBHOOK',\s*'RECONCILIATION',\s*'MANUAL_IMPORT'/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
});

const health = read("src/server/meta-leads/health.server.ts");
const panel = read("src/components/meta/MetaHealthPanel.tsx");

test("Meta health server fn gates first, then never throws an opaque failure", () => {
  const start = fns.indexOf("export const getMetaHealthFn = createServerFn");
  const body = fns.slice(start, fns.indexOf("\nexport const ", start + 1));
  const gate = body.indexOf('requireCapability(context, "integrations.manage")');
  const tryIdx = body.indexOf("try {");
  assert.ok(gate >= 0 && tryIdx > gate, "capability gate stays outside the try");
  assert.match(body, /catch \(error\)[\s\S]*ok: false as const, health: null, error: message/);
});

test("each Meta health check fails independently and reports its real error", () => {
  assert.match(health, /async function settle</);
  assert.match(health, /errors\.push\(\{ check, message \}\)/);
  // Supabase returns errors instead of throwing; every query must surface them.
  const queries = (health.match(/await (query|supabaseAdmin)/g) ?? []).length;
  const checks = (health.match(/if \(error\) throw error;/g) ?? []).length;
  assert.ok(checks >= 4 && checks >= queries - 1, "every health query checks its error");
  assert.doesNotMatch(health, /head: true/, "HEAD count queries hide the error body");
  assert.match(health, /\berrors,\n/, "errors are returned to the panel");
});

test("Meta panel shows the actual failure and keeps actions available", () => {
  assert.doesNotMatch(panel, /Meta health unavailable/);
  assert.match(panel, /loadError/);
  assert.match(panel, /data\.errors\.map/);
  assert.match(panel, /health\.refetch\(\)/, "Re-check forces a new request");
  const conditionalEnd = panel.indexOf(`<div className="mt-4">`);
  assert.ok(conditionalEnd > 0 && panel.indexOf("subscribe.mutate()") > conditionalEnd);
});
