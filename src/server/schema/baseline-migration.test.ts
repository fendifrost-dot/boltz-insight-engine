import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import productionExport from "../../../docs/schema/production-export.json" with { type: "json" };
import { Constants } from "../../integrations/supabase/types.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselinePath = join(
  repoRoot,
  "supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql",
);
const baselineSql = readFileSync(baselinePath, "utf8");

const LEAD_INBOX_TABLES = [
  "leads",
  "lead_events",
  "message_threads",
  "messages",
  "message_jobs",
  "agent_runs",
  "escalations",
  "ringcentral_subscriptions",
  "integration_health_snapshots",
];

const LEAD_INBOX_ENUMS = [
  "lead_lifecycle",
  "consent_status",
  "message_direction",
  "message_channel",
  "message_delivery_state",
  "thread_control_mode",
  "message_job_type",
  "message_job_status",
  "agent_action",
  "escalation_category",
  "escalation_status",
  "sms_capability",
];

const migrationFiles = [
  "20260825155900_baseline_ops_schema_adoption.sql",
  "20260825165448_28fff59b-8dad-453e-abdc-80c5133bdf5d.sql",
  "20260825165502_bef165f1-1a33-4591-8687-a92384202fb1.sql",
  "20260826001442_5d12525c-3d20-4454-b554-05ae0d3e0e16.sql",
  "20260826001500_c6b8bc61-c333-4d63-ad2d-ed758784bc3e.sql",
  "20260827230000_lock_role_probe_to_caller.sql",
  "20260828013000_apply_lead_lifecycle_transition.sql",
];

test("baseline is lead-inbox foundation only (no auth duplication)", () => {
  assert.doesNotMatch(baselineSql, /\bcreate table if not exists public\.user_roles\b/i);
  assert.doesNotMatch(baselineSql, /\bcreate policy\b/i);
  assert.doesNotMatch(baselineSql, /\bcreate or replace function public\.has_role\b/i);
  assert.doesNotMatch(baselineSql, /\bcreate or replace function public\.is_staff\b/i);
  assert.doesNotMatch(baselineSql, /\bbootstrap_first_owner\b/i);
  assert.doesNotMatch(baselineSql, /\bdrop table\b/i);
});

test("baseline uses duplicate-safe enum creation for every lead-inbox enum", () => {
  for (const enumName of LEAD_INBOX_ENUMS) {
    assert.match(
      baselineSql,
      new RegExp(
        `DO \\$\\$ BEGIN[\\s\\S]*CREATE TYPE public\\.${enumName}[\\s\\S]*EXCEPTION WHEN duplicate_object`,
        "i",
      ),
      `enum ${enumName} must use duplicate_object guard`,
    );
  }
  assert.doesNotMatch(baselineSql, /^CREATE TYPE public\./m);
});

test("baseline recreates triggers with DROP TRIGGER IF EXISTS first", () => {
  const triggers = [
    "lead_events_no_update",
    "lead_events_no_delete",
    "leads_set_updated_at",
    "message_threads_set_updated_at",
    "messages_set_updated_at",
    "message_jobs_set_updated_at",
    "escalations_set_updated_at",
    "ringcentral_subscriptions_set_updated_at",
  ];
  for (const name of triggers) {
    assert.match(
      baselineSql,
      new RegExp(`DROP TRIGGER IF EXISTS ${name} ON public\\.\\w+`, "i"),
      `missing drop before trigger ${name}`,
    );
    assert.match(baselineSql, new RegExp(`CREATE TRIGGER ${name}\\b`, "i"));
  }
});

test("baseline defines nine lead-inbox tables from production export", () => {
  assert.deepEqual(productionExport.leadInboxTables, LEAD_INBOX_TABLES);
  for (const table of LEAD_INBOX_TABLES) {
    assert.match(
      baselineSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, "i"),
      `missing table ${table}`,
    );
  }
});

test("production export includes columns, constraints, indexes, and function definitions", () => {
  assert.ok(Array.isArray(productionExport.columns) && productionExport.columns.length > 100);
  assert.ok(Array.isArray(productionExport.constraints) && productionExport.constraints.length > 10);
  assert.ok(Array.isArray(productionExport.indexes) && productionExport.indexes.length > 10);
  assert.ok(Array.isArray(productionExport.functionDefinitions) && productionExport.functionDefinitions.length >= 2);
  assert.ok(productionExport.rlsEnabled);
  assert.ok(Array.isArray(productionExport.policies) && productionExport.policies.length >= 10);
});

test("generated Supabase enum constants match production export lead-inbox enums", () => {
  for (const enumName of LEAD_INBOX_ENUMS) {
    const exported = productionExport.enums[enumName as keyof typeof productionExport.enums];
    const generated = Constants.public.Enums[enumName as keyof typeof Constants.public.Enums];
    assert.ok(exported, `export missing enum ${enumName}`);
    assert.ok(generated, `types.ts missing enum ${enumName}`);
    assert.deepEqual([...generated].sort(), [...exported].sort());
  }
});

test("baseline trigger functions pin search_path to public", () => {
  assert.match(baselineSql, /CREATE OR REPLACE FUNCTION public\.deny_lead_event_mutation\(\)[\s\S]*SET search_path = public/i);
  assert.match(baselineSql, /CREATE OR REPLACE FUNCTION public\.set_updated_at\(\)[\s\S]*SET search_path = public/i);
});

test("migration chain is ordered with baseline before grants migration", () => {
  const migrationsDir = join(repoRoot, "supabase/migrations");
  for (const file of migrationFiles) {
    assert.ok(readFileSync(join(migrationsDir, file), "utf8").length > 0, `missing ${file}`);
  }
  assert.deepEqual(migrationFiles.slice().sort(), migrationFiles);
  assert.ok(migrationFiles[0]?.startsWith("20260825155900"));
  assert.ok(migrationFiles[1]?.startsWith("20260825165448"));
});

test("lifecycle transition RPC migration is service-role only with pinned search_path", () => {
  const sql = readFileSync(
    join(repoRoot, "supabase/migrations/20260828013000_apply_lead_lifecycle_transition.sql"),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.apply_lead_lifecycle_transition/i);
  assert.match(sql, /set search_path = public/i);
  assert.match(sql, /grant execute on function public\.apply_lead_lifecycle_transition[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.apply_lead_lifecycle_transition[\s\S]*from public, anon, authenticated/i);
});
