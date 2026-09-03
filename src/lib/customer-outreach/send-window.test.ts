import test from "node:test";
import assert from "node:assert/strict";
import { chicagoLocalDate, isWithinOutreachSendWindow } from "./send-window.ts";

function utc(iso: string): Date {
  return new Date(iso);
}

test("Monday 9:00 AM Chicago is inside the window (CST)", () => {
  // 2026-01-12 is a Monday; CST is UTC-6.
  assert.equal(isWithinOutreachSendWindow(utc("2026-01-12T15:00:00.000Z")), true);
  assert.equal(chicagoLocalDate(utc("2026-01-12T15:00:00.000Z")), "2026-01-12");
});

test("Monday 8:59 AM Chicago is outside the window", () => {
  assert.equal(isWithinOutreachSendWindow(utc("2026-01-12T14:59:00.000Z")), false);
});

test("Monday 5:00 PM Chicago is the last included instant; 5:01 is not", () => {
  assert.equal(isWithinOutreachSendWindow(utc("2026-01-12T23:00:00.000Z")), true);
  assert.equal(isWithinOutreachSendWindow(utc("2026-01-12T23:01:00.000Z")), false);
});

test("Sunday is never in the window", () => {
  assert.equal(isWithinOutreachSendWindow(utc("2026-01-11T16:00:00.000Z")), false);
});

test("Saturday afternoon Chicago is inside the window", () => {
  assert.equal(isWithinOutreachSendWindow(utc("2026-01-10T18:00:00.000Z")), true);
});

test("DST spring-forward still uses 9 AM Chicago, not a UTC hour", () => {
  // 2026-03-08 is the second Sunday in March (DST starts). Monday 2026-03-09 is CDT (UTC-5).
  const nineAmCdt = utc("2026-03-09T14:00:00.000Z");
  assert.equal(chicagoLocalDate(nineAmCdt), "2026-03-09");
  assert.equal(isWithinOutreachSendWindow(nineAmCdt), true);
  const eightAmCdt = utc("2026-03-09T13:00:00.000Z");
  assert.equal(isWithinOutreachSendWindow(eightAmCdt), false);
});
