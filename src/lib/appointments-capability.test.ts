import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCapabilityWithProbe } from "../server/authz/capabilities.ts";
import { SHOP_TIMEZONE, formatAppointmentInstant, shopLocalToUtcIso } from "./appointments-time.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("appointments.manage requires staff and override requires owner", async () => {
  const staffProbe = { isStaff: async () => true, isOwner: async () => false };
  const ownerProbe = { isStaff: async () => true, isOwner: async () => true };
  assert.equal(await checkCapabilityWithProbe(staffProbe, "appointments.manage"), true);
  assert.equal(await checkCapabilityWithProbe(staffProbe, "appointments.override_capacity"), false);
  assert.equal(await checkCapabilityWithProbe(ownerProbe, "appointments.override_capacity"), true);
});

test("shop-local scheduling uses explicit Chicago timezone formatting", () => {
  assert.equal(SHOP_TIMEZONE, "America/Chicago");
  const iso = shopLocalToUtcIso({ date: "2026-01-15", time: "09:00" });
  assert.match(formatAppointmentInstant(iso), /Jan/);
});

test("create appointment server fn checks override capability before service-role work", () => {
  const source = readFileSync(join(repoRoot, "src/lib/appointments.functions.ts"), "utf8");
  const overrideIndex = source.indexOf('requireCapability(context, "appointments.override_capacity")');
  const createIndex = source.indexOf("createAppointment(");
  assert.ok(overrideIndex >= 0 && createIndex > overrideIndex);
});

test("owner override uses owner actor label for auditing", () => {
  const source = readFileSync(join(repoRoot, "src/lib/appointments.functions.ts"), "utf8");
  assert.match(source, /owner:\$\{userId\}/);
  assert.match(source, /resolveActor\(context\.userId, usedOwnerOverride\)/);
});

test("scheduling service uses lifecycle transition service with appointment_record evidence", () => {
  const source = readFileSync(join(repoRoot, "src/server/appointments/scheduling.server.ts"), "utf8");
  assert.match(source, /basis: "appointment_record"/);
  assert.match(source, /assertedBy: args\.assertedBy/);
  assert.match(source, /applyLifecycleTransition\(/);
});

test("appointments migration defines atomic create RPC and staff RLS", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260828130000_appointments.sql"),
    "utf8",
  );
  assert.match(migration, /create_appointment_atomic/);
  assert.match(migration, /appointments_staff_all/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_appointment_atomic/);
});
