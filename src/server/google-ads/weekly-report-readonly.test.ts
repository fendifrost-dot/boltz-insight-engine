import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveReportPeriod } from "./report-period.ts";

const here = dirname(fileURLToPath(import.meta.url));
const reportsSource = readFileSync(join(here, "reports.server.ts"), "utf8");
const routeSource = readFileSync(
  join(here, "..", "..", "routes", "api", "public", "cron", "ads-weekly.ts"),
  "utf8",
);

/** Strip comments so prose about adsMutate cannot satisfy or trip these checks. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const reportsCode = stripComments(reportsSource);
const routeCode = stripComments(routeSource);

// --- The load-bearing guarantee: V1 cannot mutate the ads account. ------------

test("reports.server.ts never references adsMutate", () => {
  assert.ok(
    !reportsCode.includes("adsMutate"),
    "the weekly-report path must not reference the ads mutation entry point",
  );
});

test("reports.server.ts imports only read helpers from the ads client", () => {
  const importMatch = reportsCode.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/client\.server["']/);
  assert.ok(importMatch, "expected a named import from ./client.server");
  const imported = (importMatch[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(imported.sort(), ["adsCustomerId", "adsSearch"]);
});

test("the ads-weekly cron route never references adsMutate", () => {
  assert.ok(
    !routeCode.includes("adsMutate"),
    "the cron endpoint must not reach the ads mutation entry point",
  );
});

test("reports.server.ts issues no mutate or write calls of any kind", () => {
  for (const forbidden of [":mutate", "adsWriteGate", "campaignBudgets", "adGroupCriteria"]) {
    assert.ok(!reportsCode.includes(forbidden), `unexpected write-path reference: ${forbidden}`);
  }
});

test("the ads-weekly route only accepts POST", () => {
  const handlers = routeCode.match(/handlers:\s*\{([\s\S]*?)\n\s{4}\},/);
  assert.ok(handlers, "expected a handlers block");
  const handlerBody = handlers[1] ?? "";
  assert.ok(handlerBody.includes("POST:"), "expected a POST handler");
  for (const verb of ["GET:", "PUT:", "PATCH:", "DELETE:"]) {
    assert.ok(!handlerBody.includes(verb), `unexpected ${verb} handler on a cron endpoint`);
  }
});

test("the ads-weekly route authorizes the cron bearer before doing any work", () => {
  const authIdx = routeCode.indexOf("authorizeCron(request)");
  const reportIdx = routeCode.indexOf("getAdsWeeklyReport");
  assert.ok(authIdx >= 0, "missing cron authorization");
  assert.ok(reportIdx >= 0, "missing report call");
  assert.ok(authIdx < reportIdx, "cron auth must run before the Google Ads call");
});

// --- Fixed, server-controlled GAQL -------------------------------------------

test("search terms come from search_term_view and keywords from keyword_view", () => {
  assert.ok(reportsCode.includes("FROM search_term_view"), "missing search_term_view query");
  assert.ok(reportsCode.includes("FROM keyword_view"), "missing keyword_view query");
  assert.ok(
    !reportsCode.includes("FROM campaign_search_term_view"),
    "Performance Max search terms are a different resource and must not be blended into V1",
  );
});

test("both reports select the fields the Monday report depends on", () => {
  for (const field of [
    "segments.date",
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
  ]) {
    const occurrences = reportsCode.split(field).length - 1;
    assert.ok(occurrences >= 2, `${field} should be selected by both reports, saw ${occurrences}`);
  }
  assert.ok(
    reportsCode.includes("segments.keyword.info.match_type"),
    "search terms need match type",
  );
  assert.ok(
    reportsCode.includes("ad_group_criterion.keyword.match_type"),
    "keywords need match type",
  );
});

test("the route never interpolates caller text into GAQL", () => {
  // `days` is the only caller-controlled input and must be a bounded integer.
  assert.ok(routeCode.includes("Number.isInteger(parsedDays)"), "days must be integer-validated");
  assert.ok(routeCode.includes("parsedDays > 90"), "days must be upper-bounded");
});

// --- Explicit reporting dates ------------------------------------------------

test("a 7-day window ends yesterday and spans 7 calendar days", () => {
  const period = resolveReportPeriod({
    timeZone: "America/Chicago",
    days: 7,
    now: new Date("2026-09-21T15:00:00Z"), // Mon 2026-09-21 10:00 Chicago
  });
  assert.equal(period.end, "2026-09-20");
  assert.equal(period.start, "2026-09-14");
  assert.equal(period.days, 7);
  assert.equal(period.time_zone, "America/Chicago");
});

test("the window is resolved in the account time zone, not the server's", () => {
  // 2026-09-21T02:00:00Z is still Sun 2026-09-20 in Chicago (UTC-5).
  const chicago = resolveReportPeriod({
    timeZone: "America/Chicago",
    now: new Date("2026-09-21T02:00:00Z"),
  });
  const utc = resolveReportPeriod({ timeZone: "UTC", now: new Date("2026-09-21T02:00:00Z") });
  assert.equal(chicago.end, "2026-09-19");
  assert.equal(utc.end, "2026-09-20");
});

test("windows crossing a month boundary shift the month correctly", () => {
  const period = resolveReportPeriod({
    timeZone: "UTC",
    days: 7,
    now: new Date("2026-03-03T12:00:00Z"),
  });
  assert.equal(period.end, "2026-03-02");
  assert.equal(period.start, "2026-02-24");
});

test("day counts are clamped and defaulted", () => {
  const now = new Date("2026-09-21T15:00:00Z");
  assert.equal(resolveReportPeriod({ timeZone: "UTC", now }).days, 7);
  assert.equal(resolveReportPeriod({ timeZone: "UTC", days: 0, now }).days, 1);
  assert.equal(resolveReportPeriod({ timeZone: "UTC", days: 5000, now }).days, 90);
  assert.equal(resolveReportPeriod({ timeZone: "UTC", days: 7.9, now }).days, 7);
});

test("an unusable account time zone falls back to UTC instead of throwing", () => {
  const period = resolveReportPeriod({
    timeZone: "Not/AZone",
    now: new Date("2026-09-21T15:00:00Z"),
  });
  assert.equal(period.time_zone, "UTC");
  assert.equal(period.end, "2026-09-20");
});

test("resolved dates are always plain GAQL date literals", () => {
  for (const days of [1, 7, 30, 90]) {
    const period = resolveReportPeriod({
      timeZone: "UTC",
      days,
      now: new Date("2026-01-01T00:30:00Z"),
    });
    assert.match(period.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(period.end, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// --- Secret hygiene ----------------------------------------------------------

test("no secret name is ever placed in the report payload or logged", () => {
  for (const secret of [
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY",
    "access_token",
  ]) {
    assert.ok(!reportsCode.includes(secret), `reports must not touch ${secret}`);
    assert.ok(!routeCode.includes(secret), `the route must not touch ${secret}`);
  }
});

test("the report never logs the raw provider response", () => {
  assert.ok(!reportsCode.includes("console.log"), "no ad-hoc logging in the report path");
});
