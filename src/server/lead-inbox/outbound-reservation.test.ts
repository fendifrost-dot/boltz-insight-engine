import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOutboundReservationResult } from "./outbound-reservation.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("parseOutboundReservationResult accepts send, skip, and review actions", () => {
  assert.equal(parseOutboundReservationResult({ action: "send", status: "sending" }).action, "send");
  assert.equal(parseOutboundReservationResult({ action: "skip", status: "sent" }).action, "skip");
  assert.equal(parseOutboundReservationResult({ action: "review", status: "ambiguous" }).action, "review");
});

test("outbound send reserves before provider call", () => {
  const source = readFileSync(join(repoRoot, "src/server/lead-inbox/outbound.server.ts"), "utf8");
  const reserveIndex = source.indexOf("reserveOutboundSend(");
  const sendIndex = source.indexOf("await sendSms(");
  assert.ok(reserveIndex >= 0 && sendIndex > reserveIndex);
});

test("recordOutboundMessage no longer pre-checks idempotency before insert", () => {
  const source = readFileSync(join(repoRoot, "src/server/lead-inbox/store.server.ts"), "utf8");
  assert.doesNotMatch(source, /findOutboundMessageByIdempotencyKey[\s\S]*?recordOutboundMessage/);
  assert.match(source, /\.insert\(\{[\s\S]*idempotency_key: args\.idempotencyKey/);
});
