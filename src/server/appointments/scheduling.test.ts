import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("scheduling service includes assertedBy in appointment lifecycle evidence", () => {
  const source = readFileSync(join(repoRoot, "src/server/appointments/scheduling.server.ts"), "utf8");
  assert.match(source, /basis: "appointment_record"/);
  assert.match(source, /assertedBy: args\.assertedBy/);
  assert.match(source, /applyLifecycleTransition\(/);
});

test("scheduling service uses atomic RPCs for appointment mutations", () => {
  const source = readFileSync(join(repoRoot, "src/server/appointments/scheduling.server.ts"), "utf8");
  assert.match(source, /reschedule_appointment_atomic/);
  assert.match(source, /cancel_appointment_atomic/);
  assert.match(source, /mark_appointment_arrived_atomic/);
  assert.match(source, /mark_appointment_no_show_atomic/);
  assert.doesNotMatch(source, /from\("appointments"\)\s*\n\s*\.update\(/);
});

test("appointments migration allows overlapping arrival windows and atomic mutation RPCs", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260828130000_appointments.sql"),
    "utf8",
  );
  assert.match(migration, /create_appointment_atomic/);
  assert.match(migration, /reschedule_appointment_atomic/);
  assert.match(migration, /cancel_appointment_atomic/);
  assert.doesNotMatch(migration, /status', 'conflict'/);
  assert.doesNotMatch(migration, /pg_advisory_xact_lock/);
});
