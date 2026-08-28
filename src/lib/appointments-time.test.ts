import test from "node:test";
import assert from "node:assert/strict";
import {
  ShopLocalTimeError,
  shopDayRangeIso,
  shopLocalDateFromInstant,
  shopLocalTimeFromInstant,
  shopLocalToUtcIso,
  shopLocalToday,
  shopStartOfWeek,
  shopWeekRangeIso,
} from "./appointments-time.ts";

test("Chicago midnight boundary converts shop-local input to UTC ISO", () => {
  const iso = shopLocalToUtcIso({ date: "2026-03-08", time: "00:30" });
  assert.match(iso, /T\d{2}:30:00\.000Z$/);
});

test("shop-local conversion rejects malformed input", () => {
  assert.throws(() => shopLocalToUtcIso({ date: "bad", time: "09:00" }), ShopLocalTimeError);
});

test("shop-local conversion rejects nonexistent spring-forward times", () => {
  assert.throws(
    () => shopLocalToUtcIso({ date: "2026-03-08", time: "02:30" }),
    (error: unknown) =>
      error instanceof ShopLocalTimeError &&
      /does not exist/i.test(error.message),
  );
});

test("shop-local conversion rejects ambiguous fall-back times without disambiguation", () => {
  assert.throws(
    () => shopLocalToUtcIso({ date: "2026-11-01", time: "01:30" }),
    (error: unknown) =>
      error instanceof ShopLocalTimeError && /ambiguous/i.test(error.message),
  );
});

test("shop-local conversion accepts ambiguous fall-back times with explicit disambiguation", () => {
  const earlier = shopLocalToUtcIso({
    date: "2026-11-01",
    time: "01:30",
    disambiguation: "earlier",
  });
  const later = shopLocalToUtcIso({
    date: "2026-11-01",
    time: "01:30",
    disambiguation: "later",
  });
  assert.notEqual(earlier, later);
});

test("shop schedule helpers derive Chicago-local ranges and labels", () => {
  const today = shopLocalToday();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const weekStart = shopStartOfWeek(today);
  const weekRange = shopWeekRangeIso(weekStart);
  assert.ok(Date.parse(weekRange.toIso) > Date.parse(weekRange.fromIso));
  const dayRange = shopDayRangeIso(today);
  assert.ok(Date.parse(dayRange.toIso) > Date.parse(dayRange.fromIso));
  const iso = shopLocalToUtcIso({ date: "2026-01-15", time: "09:00" });
  assert.equal(shopLocalDateFromInstant(iso), "2026-01-15");
  assert.equal(shopLocalTimeFromInstant(iso), "09:00");
});
