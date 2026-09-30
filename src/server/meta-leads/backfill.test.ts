import test from "node:test";
import assert from "node:assert/strict";
import { contactedPhoneSet, parseBackfillSince } from "./normalize.ts";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const MAX_LOOKBACK_MINUTES = 90 * 24 * 60;

test("a date-only since includes that UTC day and stays inside 90 days", () => {
  const parsed = parseBackfillSince("2026-09-26", NOW, MAX_LOOKBACK_MINUTES);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.iso, "2026-09-26T00:00:00.000Z");
  assert.equal(parsed.sinceUnix, Math.floor(parsed.sinceMs / 1000) - 1);
});

test("since rejects a future date, an old date, and a non-date without echoing the input", () => {
  const future = parseBackfillSince("2026-10-02", NOW, MAX_LOOKBACK_MINUTES);
  const old = parseBackfillSince("2020-01-01", NOW, MAX_LOOKBACK_MINUTES);
  const junk = parseBackfillSince("not-a-date", NOW, MAX_LOOKBACK_MINUTES);
  assert.deepEqual(future, { error: "since is in the future" });
  assert.deepEqual(old, { error: "since is older than 90 days" });
  assert.deepEqual(junk, { error: "since must be YYYY-MM-DD or an ISO timestamp" });
  assert.equal(JSON.stringify(junk).includes("not-a-date"), false);
});

test("contacted numbers compare as E.164 and invalid entries are only counted", () => {
  const parsed = contactedPhoneSet(["+1 (312) 555-0199", "3125550199", "nope", ""]);
  assert.equal(parsed.phones.size, 1);
  assert.equal([...parsed.phones][0], "+13125550199");
  assert.equal(parsed.ignored, 2);
  const other = contactedPhoneSet(["312-555-0199"]);
  assert.equal([...parsed.phones][0], [...other.phones][0]);
});
