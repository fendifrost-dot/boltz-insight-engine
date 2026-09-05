import test from "node:test";
import assert from "node:assert/strict";
import { classifySquareLine } from "./classify-square-line.ts";

test("oil change item with vehicle in the note", () => {
  const result = classifySquareLine("Oil change", "2012 Chevy equinox LT");
  assert.equal(result.parseStatus, "classified");
  assert.deepEqual(result.reminderKinds, ["oil"]);
  assert.equal(result.vehicleYear, 2012);
  assert.equal(result.vehicleMake, "Chevrolet");
  assert.match(result.vehicleModel ?? "", /equinox/i);
  assert.equal(result.excludeReason, null);
});

test("vehicle in the item name, oil in the note", () => {
  const result = classifySquareLine("2015 Chrysler 200", "Engine mounts / Trans mount / Oil change");
  assert.equal(result.parseStatus, "classified");
  assert.deepEqual(result.reminderKinds, ["oil"]);
  assert.equal(result.vehicleYear, 2015);
  assert.equal(result.vehicleMake, "Chrysler");
  assert.match(result.vehicleModel ?? "", /200/);
});

test("combined starter and oil item with vehicle in the note", () => {
  const result = classifySquareLine("Starter & oil change", "2014 Audi Q5");
  assert.equal(result.parseStatus, "classified");
  assert.deepEqual(result.reminderKinds, ["oil"]);
  assert.equal(result.vehicleYear, 2014);
  assert.equal(result.vehicleMake, "Audi");
  assert.equal(result.vehicleModel, "Q5");
});

test("generic payment lines are excluded, not dropped without a reason", () => {
  for (const item of ["Custom Amount", "Balance", "Deposit"]) {
    const result = classifySquareLine(item, "");
    assert.equal(result.parseStatus, "excluded", item);
    assert.equal(result.excludeReason, "deposit_balance_or_custom_amount", item);
  }
});

test("diagnostic-only is excluded", () => {
  const result = classifySquareLine("Diagnostic", "Check engine light");
  assert.equal(result.parseStatus, "excluded");
  assert.equal(result.excludeReason, "diagnostic_only");
});

test("unrecognized mechanical work goes to human review instead of being dropped", () => {
  const result = classifySquareLine("Starter replacement", "2014 Audi Q5");
  assert.equal(result.parseStatus, "needs_review");
  assert.equal(result.needsReviewReason, "no_v1_service_keyword");
  assert.equal(result.vehicleYear, 2014);
  assert.equal(result.vehicleMake, "Audi");
});

test("body or insurance mixed with oil needs a human", () => {
  const result = classifySquareLine("Oil change", "Insurance claim / 2012 Chevy equinox");
  assert.equal(result.parseStatus, "needs_review");
  assert.deepEqual(result.reminderKinds, ["oil"]);
  assert.equal(result.needsReviewReason, "mechanical_line_on_body_or_insurance_invoice");
});
