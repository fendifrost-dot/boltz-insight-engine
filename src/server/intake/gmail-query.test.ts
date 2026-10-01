import test from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_INTAKE_DEFAULT_SINCE,
  gmailLeadQuery,
  parseIntakeSince,
} from "./gmail-query.ts";

test("the Gmail query includes Yelp and Durable senders and starts the day before since", () => {
  const query = gmailLeadQuery(Date.parse(EMAIL_INTAKE_DEFAULT_SINCE));
  assert.match(query, /^after:2026\/09\/25 /);
  assert.match(query, /from:messaging\.yelp\.com/);
  assert.match(query, /from:notifications@email\.durable\.com/);
  assert.match(query, /from:support@durable\.team/);
  assert.match(query, /New website lead/);
});

test("since accepts a day and rejects the future and a window past 120 days", () => {
  const now = Date.parse("2026-10-01T18:00:00.000Z");
  assert.deepEqual(parseIntakeSince("2026-09-26", now, now), {
    sinceMs: Date.parse("2026-09-26T00:00:00.000Z"),
  });
  assert.deepEqual(parseIntakeSince(undefined, now, now - 1000), { sinceMs: now - 1000 });
  assert.deepEqual(parseIntakeSince("2026-10-02", now, now), { error: "since is in the future" });
  assert.deepEqual(parseIntakeSince("2026-01-01", now, now), { error: "since is older than 120 days" });
  assert.deepEqual(parseIntakeSince("yesterday", now, now), { error: "since must be YYYY-MM-DD" });
});
