import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocations, type SquareLocation } from "./api.ts";

function location(id: string, status = "ACTIVE", name: string | null = null): SquareLocation {
  return { id, status, name };
}

test("uses the only active location and ignores inactive ones", () => {
  const choice = resolveLocations({
    configuredId: null,
    locations: [location("L_OLD", "INACTIVE", "Closed"), location("L_SHOP", "ACTIVE", "Boltz")],
  });
  assert.equal(choice.mode, "discovered");
  assert.equal(choice.resolvedLocationId, "L_SHOP");
  assert.deepEqual(choice.orderLocationIds, ["L_SHOP"]);
  assert.equal(choice.paymentsLocationId, "L_SHOP");
});

test("does not guess when several locations are active", () => {
  const choice = resolveLocations({
    configuredId: null,
    locations: [location("L_A"), location("L_B"), location("L_OLD", "INACTIVE")],
  });
  assert.equal(choice.mode, "ambiguous");
  assert.equal(choice.resolvedLocationId, null);
  assert.equal(choice.paymentsLocationId, undefined);
  assert.deepEqual(choice.orderLocationIds, ["L_A", "L_B"]);
  assert.equal(choice.orderLocationIds[0] === "L_A" && choice.resolvedLocationId === null, true);
});

test("a configured location id is used even when discovery lists others", () => {
  const choice = resolveLocations({
    configuredId: "L_PIN",
    locations: [location("L_A"), location("L_B")],
  });
  assert.equal(choice.mode, "configured");
  assert.equal(choice.resolvedLocationId, "L_PIN");
  assert.deepEqual(choice.orderLocationIds, ["L_PIN"]);
});

test("no active location leaves order search empty", () => {
  const choice = resolveLocations({
    configuredId: null,
    locations: [location("L_OLD", "INACTIVE")],
  });
  assert.equal(choice.mode, "none");
  assert.deepEqual(choice.orderLocationIds, []);
  assert.equal(choice.paymentsLocationId, undefined);
});
