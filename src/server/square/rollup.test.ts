import test from "node:test";
import assert from "node:assert/strict";
import { chicagoWeekStart, parseSinceDate, rollupSquareWeeks, syncBeginIso } from "./rollup.ts";

test("Chicago weeks start on Monday, including the DST boundary", () => {
  assert.equal(chicagoWeekStart("2026-01-05T15:00:00.000Z"), "2026-01-05");
  assert.equal(chicagoWeekStart("2026-01-05T05:30:00.000Z"), "2025-12-29");
  assert.equal(chicagoWeekStart("2026-07-06T05:00:00.000Z"), "2026-07-06");
  assert.equal(chicagoWeekStart("2026-07-06T04:30:00.000Z"), "2026-06-29");
});

test("backfill since is a UTC date and incremental overlaps the last success", () => {
  const now = new Date("2026-10-09T12:00:00.000Z");
  assert.equal(parseSinceDate("2026-01-15", now).ok, true);
  assert.equal(parseSinceDate("2026-13-01", now).ok, false);
  assert.equal(parseSinceDate("2026-10-10", now).ok, false);
  assert.equal(parseSinceDate("", now).ok, false);
  assert.equal(
    syncBeginIso({
      mode: "backfill",
      sinceDate: "2026-01-15",
      syncedThrough: null,
      now,
    }),
    "2026-01-15T00:00:00.000Z",
  );
  assert.equal(
    syncBeginIso({
      mode: "incremental",
      sinceDate: null,
      syncedThrough: "2026-10-09T12:00:00.000Z",
      now,
    }),
    "2026-10-09T06:00:00.000Z",
  );
});

test("weekly rollup reports gross, refunds, net, tickets, average, and source", () => {
  const weeks = rollupSquareWeeks({
    payments: [
      {
        status: "COMPLETED",
        amountCents: 10_000,
        createdAt: "2026-01-05T15:00:00.000Z",
        leadId: "lead-ads",
      },
      {
        status: "COMPLETED",
        amountCents: 5_000,
        createdAt: "2026-01-06T15:00:00.000Z",
        leadId: null,
      },
      {
        status: "CANCELED",
        amountCents: 9_000,
        createdAt: "2026-01-06T15:00:00.000Z",
        leadId: "lead-ads",
      },
    ],
    refunds: [{ status: "COMPLETED", amountCents: 1_000, createdAt: "2026-01-07T15:00:00.000Z" }],
    leadSources: new Map([["lead-ads", "google_ads"]]),
  });
  assert.equal(weeks.length, 1);
  const week = weeks[0]!;
  assert.equal(week.weekStart, "2026-01-05");
  assert.equal(week.grossCents, 15_000);
  assert.equal(week.refundCents, 1_000);
  assert.equal(week.netCents, 14_000);
  assert.equal(week.ticketCount, 2);
  assert.equal(week.avgTicketCents, 7_500);
  assert.deepEqual(week.attributedBySource, { google_ads: 10_000 });
});
