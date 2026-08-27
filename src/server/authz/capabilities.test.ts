import test from "node:test";
import assert from "node:assert/strict";
import {
  capabilityAccessCheck,
  capabilityRequiresOwner,
  capabilityRequiresStaff,
  checkCapabilityWithProbe,
} from "./capabilities.ts";

test("communications.send requires staff membership", () => {
  assert.equal(capabilityRequiresStaff("communications.send"), true);
  assert.equal(capabilityRequiresOwner("communications.send"), false);
  assert.equal(capabilityAccessCheck("communications.send"), "is_staff");
});

test("integrations.manage requires owner role", () => {
  assert.equal(capabilityRequiresOwner("integrations.manage"), true);
  assert.equal(capabilityRequiresStaff("integrations.manage"), false);
});

test("checkCapabilityWithProbe allows staff for communications.send", async () => {
  const allowed = await checkCapabilityWithProbe(
    {
      isStaff: async () => true,
      isOwner: async () => false,
    },
    "communications.send",
  );
  assert.equal(allowed, true);
});

test("checkCapabilityWithProbe allows owner for communications.send", async () => {
  const allowed = await checkCapabilityWithProbe(
    {
      isStaff: async () => true,
      isOwner: async () => true,
    },
    "communications.send",
  );
  assert.equal(allowed, true);
});

test("checkCapabilityWithProbe rejects authenticated user without staff role", async () => {
  const allowed = await checkCapabilityWithProbe(
    {
      isStaff: async () => false,
      isOwner: async () => false,
    },
    "communications.send",
  );
  assert.equal(allowed, false);
});

test("checkCapabilityWithProbe rejects staff for owner-only integrations.manage", async () => {
  const allowed = await checkCapabilityWithProbe(
    {
      isStaff: async () => true,
      isOwner: async () => false,
    },
    "integrations.manage",
  );
  assert.equal(allowed, false);
});

test("checkCapabilityWithProbe allows owner for integrations.manage", async () => {
  const allowed = await checkCapabilityWithProbe(
    {
      isStaff: async () => true,
      isOwner: async () => true,
    },
    "integrations.manage",
  );
  assert.equal(allowed, true);
});
