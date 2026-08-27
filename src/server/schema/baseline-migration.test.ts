import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import inventory from "../../../docs/schema/production-inventory.json" with { type: "json" };
import { Constants } from "../../integrations/supabase/types.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselinePath = join(
  repoRoot,
  "supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql",
);
const baselineSql = readFileSync(baselinePath, "utf8");

const migrationFiles = [
  "20260825155900_baseline_ops_schema_adoption.sql",
  "20260825165448_28fff59b-8dad-453e-abdc-80c5133bdf5d.sql",
  "20260825165502_bef165f1-1a33-4591-8687-a92384202fb1.sql",
  "20260826001442_5d12525c-3d20-4454-b554-05ae0d3e0e16.sql",
  "20260826001500_c6b8bc61-c333-4d63-ad2d-ed758784bc3e.sql",
  "20260827230000_lock_role_probe_to_caller.sql",
];

test("baseline migration is additive (no drop table / recreate)", () => {
  assert.doesNotMatch(baselineSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(baselineSql, /\btruncate\b/i);
  assert.match(baselineSql, /CREATE TABLE IF NOT EXISTS/i);
  assert.match(baselineSql, /CREATE EXTENSION IF NOT EXISTS/i);
});

test("baseline migration defines all production tables", () => {
  for (const table of inventory.tables) {
    assert.match(
      baselineSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, "i"),
      `missing table ${table}`,
    );
  }
});

test("baseline migration defines all production enums", () => {
  for (const enumName of Object.keys(inventory.enums)) {
    assert.match(
      baselineSql,
      new RegExp(`CREATE TYPE public\\.${enumName}\\b`, "i"),
      `missing enum ${enumName}`,
    );
  }
});

test("baseline migration defines required functions and triggers", () => {
  for (const fn of inventory.functions) {
    assert.match(
      baselineSql,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`, "i"),
      `missing function ${fn}`,
    );
  }

  for (const trigger of inventory.triggers) {
    if (trigger.table.startsWith("auth.")) continue;
    assert.match(
      baselineSql,
      new RegExp(`CREATE TRIGGER ${trigger.name}\\b`, "i"),
      `missing trigger ${trigger.name}`,
    );
  }
});

test("baseline migration defines staff/owner RLS policies", () => {
  for (const policy of inventory.policies) {
    assert.match(
      baselineSql,
      new RegExp(`CREATE POLICY ${policy}\\b`, "i"),
      `missing policy ${policy}`,
    );
  }
});

test("generated Supabase enum constants match production inventory", () => {
  for (const [enumName, values] of Object.entries(inventory.enums)) {
    const generated = Constants.public.Enums[enumName as keyof typeof Constants.public.Enums];
    assert.ok(generated, `types.ts missing enum ${enumName}`);
    assert.deepEqual([...generated].sort(), [...values].sort());
  }
});

test("migration chain is ordered and includes baseline first", () => {
  const migrationsDir = join(repoRoot, "supabase/migrations");
  for (const file of migrationFiles) {
    assert.ok(
      readFileSync(join(migrationsDir, file), "utf8").length > 0,
      `missing migration ${file}`,
    );
  }

  const sorted = migrationFiles.slice().sort();
  assert.deepEqual(sorted, migrationFiles, "migration timestamps out of order");
});
