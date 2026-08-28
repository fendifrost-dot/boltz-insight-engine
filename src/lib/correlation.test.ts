import test from "node:test";
import assert from "node:assert/strict";
import { deriveInboundCorrelationId } from "./correlation.ts";

test("deriveInboundCorrelationId is deterministic for the same provider message", () => {
  const first = deriveInboundCorrelationId("1234567890");
  const second = deriveInboundCorrelationId("1234567890");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test("deriveInboundCorrelationId differs across provider message ids", () => {
  assert.notEqual(
    deriveInboundCorrelationId("111"),
    deriveInboundCorrelationId("222"),
  );
});

test("webhook and reconciliation paths converge on the same correlation id", () => {
  const providerMessageId = "9876543210";
  const webhook = deriveInboundCorrelationId(providerMessageId);
  const reconciliation = deriveInboundCorrelationId(providerMessageId);
  assert.equal(webhook, reconciliation);
});
