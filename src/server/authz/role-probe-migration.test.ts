import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations/20260827230000_lock_role_probe_to_caller.sql",
);

test("role probe migration binds has_role to auth.uid()", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /create or replace function public\.has_role/i);
  assert.match(sql, /_user_id = auth\.uid\(\)/);
  assert.match(sql, /where user_id = auth\.uid\(\)/);
});

test("role probe migration binds is_staff to auth.uid()", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /create or replace function public\.is_staff/i);
  assert.match(sql, /revoke all on function public\.is_staff\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.is_staff\(uuid\) to authenticated/);
});
