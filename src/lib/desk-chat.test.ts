import test from "node:test";
import assert from "node:assert/strict";
import {
  chicagoAppointmentIso,
  shopDayBounds,
  shopDate,
  appointmentLocal,
} from "./desk-schedule.ts";
import { shopMessageSchema, shopMessageKey, shopChatReadSchema } from "./desk-chat.ts";
import { toolsForScopes, summarizeToolArgs } from "../server/mcp/protocol.ts";

test("today and appointments use Chicago rather than the browser/server timezone", () => {
  assert.equal(shopDate(new Date("2026-10-10T02:00:00Z")), "2026-10-09");
  assert.equal(chicagoAppointmentIso("2026-10-09T09:30"), "2026-10-09T14:30:00.000Z");
  assert.equal(chicagoAppointmentIso("2026-12-09T09:30"), "2026-12-09T15:30:00.000Z");
  assert.equal(appointmentLocal("2026-10-09T14:30:00Z"), "2026-10-09T09:30");
});

test("schedule covers the actual 23- and 25-hour DST days, not a hardcoded offset", () => {
  const spring = shopDayBounds("2026-03-08");
  const fall = shopDayBounds("2026-11-01");
  assert.equal(Date.parse(spring.end) - Date.parse(spring.start), 23 * 3600_000);
  assert.equal(Date.parse(fall.end) - Date.parse(fall.start), 25 * 3600_000);
  assert.equal(chicagoAppointmentIso("2026-03-08T02:30"), null);
  assert.equal(chicagoAppointmentIso("2026-11-01T01:30"), null);
  assert.equal(chicagoAppointmentIso("2026-02-30T10:00"), null);
  assert.throws(() => shopDayBounds("2026-02-30"));
});

test("a read-only agent can read shop chat and appointments but cannot post", () => {
  const read = toolsForScopes(["read"]).map((tool) => tool.name);
  assert.ok(read.includes("boltz_shop_chat"));
  assert.ok(read.includes("boltz_shop_schedule"));
  assert.ok(!read.includes("boltz_post_shop_message"));
  assert.ok(
    toolsForScopes(["leads.write"]).some((tool) => tool.name === "boltz_post_shop_message"),
  );
});

test("chat retries are actor-specific and clients cannot spoof sender or role", () => {
  const key = "00000000-0000-4000-8000-000000000001";
  assert.equal(shopMessageKey("staff:a", key), shopMessageKey("staff:a", key));
  assert.notEqual(shopMessageKey("staff:a", key), shopMessageKey("staff:b", key));
  assert.ok(
    shopMessageSchema.safeParse({ text: "Who is scheduled today?", idempotencyKey: key }).success,
  );
  for (const extra of [{ role: "assistant" }, { sender: "Grok" }, { agentId: key }]) {
    assert.equal(
      shopMessageSchema.safeParse({ text: "test", idempotencyKey: key, ...extra }).success,
      false,
    );
  }
  assert.equal(shopMessageSchema.safeParse({ text: "  ", idempotencyKey: key }).success, false);
  assert.equal(shopChatReadSchema.safeParse({ after: -1 }).success, false);
  assert.equal(shopChatReadSchema.safeParse({ limit: 101 }).success, false);
  assert.deepEqual(
    summarizeToolArgs({ text: "Look up 773-555-0100", body: "customer details", replyTo: key }),
    { textLength: 20, bodyLength: 16 },
  );
});
