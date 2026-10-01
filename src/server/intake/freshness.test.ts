import test from "node:test";
import assert from "node:assert/strict";
import { freshnessVerdict, isBusinessDay } from "./freshness.ts";

const thursday = new Date("2026-10-01T18:00:00.000Z");
const sunday = new Date("2026-10-04T18:00:00.000Z");

test("Sunday in Chicago is not a business day", () => {
  assert.equal(isBusinessDay(sunday), false);
  assert.equal(isBusinessDay(thursday), true);
});

test("a quiet source on a business day is not ok", () => {
  const none = freshnessVerdict({
    now: thursday,
    lastLeadAt: null,
    quietHours: 48,
    label: "Yelp",
  });
  assert.equal(none.ok, false);
  assert.match(none.detail, /0 leads recorded/);

  const stale = freshnessVerdict({
    now: thursday,
    lastLeadAt: "2026-09-26T00:00:00.000Z",
    quietHours: 48,
    label: "Durable website",
  });
  assert.equal(stale.ok, false);
  assert.match(stale.detail, /threshold 48h/);
});

test("a recent lead on a business day is ok", () => {
  const recent = freshnessVerdict({
    now: thursday,
    lastLeadAt: "2026-10-01T16:00:00.000Z",
    quietHours: 48,
    label: "RingCentral SMS",
  });
  assert.equal(recent.ok, true);
  assert.match(recent.detail, /2h ago/);
});

test("Sunday does not fail a source that has never produced a lead", () => {
  const closed = freshnessVerdict({
    now: sunday,
    lastLeadAt: null,
    quietHours: 24,
    label: "Google LSA",
  });
  assert.equal(closed.ok, true);
  assert.match(closed.detail, /shop closed/);
});
