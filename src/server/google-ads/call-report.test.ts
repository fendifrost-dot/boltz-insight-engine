import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CALL_REPORTING_OFF_DETAIL,
  aggregateCalls,
  callConversionsQuery,
  callViewQuery,
  countLeadFormSubmissions,
  isCallWindow,
  lastFullWeek,
  leadFormCountQuery,
  phoneCallsQuery,
  resolveCallWindow,
  toCallReport,
  weeklySnapshot,
  type CallWindow,
} from "./call-report.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSource(path: string): string {
  return stripComments(readFileSync(path, "utf8"));
}

const reportSource = readSource(join(here, "call-report.ts"));
const serverSource = readSource(join(here, "call-report.server.ts"));
const routeSource = readSource(join(here, "../../routes/api/public/cron/ads-calls.ts"));
const migration = readFileSync(
  join(repoRoot, "supabase/migrations/20261002150000_ads_call_weekly.sql"),
  "utf8",
);

const window: CallWindow = {
  since: "2026-09-21",
  until: "2026-09-27",
  time_zone: "America/Chicago",
};

const baseReport = {
  window,
  customerId: "1234567890",
  callRows: [] as unknown[],
  callError: null,
  leadRows: [] as unknown[],
  leadError: null,
  phoneRows: [] as unknown[],
  phoneError: null,
  conversionRows: [] as unknown[],
  conversionError: null,
  stored: false,
  generatedAt: "2026-09-28T13:00:00.000Z",
};

// --- GAQL -------------------------------------------------------------------

test("call_view query selects the reporting fields and no caller fields", () => {
  const query = callViewQuery(window);
  for (const field of [
    "call_view.start_call_date_time",
    "call_view.call_duration_seconds",
    "call_view.call_status",
    "call_view.call_tracking_display_location",
    "call_view.type",
    "campaign.id",
    "campaign.name",
  ]) {
    assert.ok(query.includes(field), `missing ${field}`);
  }
  assert.match(query, /FROM call_view/);
  assert.match(query, /start_call_date_time >= '2026-09-21 00:00:00'/);
  assert.match(query, /start_call_date_time < '2026-09-28 00:00:00'/);
  assert.doesNotMatch(query, /caller_/);
  assert.doesNotMatch(query, /mutate/i);
});

test("the call window end is exclusive of the next calendar day", () => {
  const monthEnd = callViewQuery({ ...window, since: "2026-09-30", until: "2026-09-30" });
  assert.match(monthEnd, />= '2026-09-30 00:00:00'/);
  assert.match(monthEnd, /< '2026-10-01 00:00:00'/);
  const yearEnd = callViewQuery({ ...window, since: "2025-12-31", until: "2025-12-31" });
  assert.match(yearEnd, /< '2026-01-01 00:00:00'/);
});

test("lead form count query selects only the submission id", () => {
  const query = leadFormCountQuery(window);
  assert.match(query, /SELECT lead_form_submission_data\.id/);
  assert.match(query, /FROM lead_form_submission_data/);
  assert.match(query, /submission_date_time >= '2026-09-21 00:00:00'/);
  assert.match(query, /submission_date_time < '2026-09-28 00:00:00'/);
  assert.doesNotMatch(query, /submission_fields/);
  assert.doesNotMatch(query, /caller_/);
});

test("phone_calls and call conversions are separate fixed campaign queries", () => {
  const phone = phoneCallsQuery(window);
  const conversions = callConversionsQuery(window);
  assert.match(phone, /metrics\.phone_calls/);
  assert.match(phone, /FROM campaign/);
  assert.match(phone, /segments\.date BETWEEN '2026-09-21' AND '2026-09-27'/);
  assert.doesNotMatch(phone, /PHONE_CALL_LEAD/);
  assert.match(conversions, /metrics\.conversions/);
  assert.match(conversions, /segments\.conversion_action_category = 'PHONE_CALL_LEAD'/);
  assert.doesNotMatch(conversions, /phone_calls/);
  assert.doesNotMatch(phone + conversions, /caller_/);
});

test("query builders reject a date that is not a YYYY-MM-DD literal", () => {
  const bad = { ...window, since: "2026-09-21' OR '1'='1" };
  assert.throws(() => callViewQuery(bad), /Invalid reporting date/);
  assert.throws(() => leadFormCountQuery(bad), /Invalid reporting date/);
  assert.throws(() => phoneCallsQuery(bad), /Invalid reporting date/);
  assert.throws(() => callConversionsQuery(bad), /Invalid reporting date/);
});

test("the route does not assemble GAQL or accept a request body", () => {
  assert.doesNotMatch(routeSource, /FROM call_view/);
  assert.doesNotMatch(routeSource, /request\.json|request\.text/);
  assert.match(routeSource, /resolveCallWindow/);
});

// --- Window -----------------------------------------------------------------

test("the default window is the last full Monday-Sunday week in Chicago", () => {
  // Friday 2026-10-02 10:00 Chicago (UTC-5).
  const friday = resolveCallWindow({ now: new Date("2026-10-02T15:00:00Z") });
  assert.ok(isCallWindow(friday));
  assert.equal(friday.since, "2026-09-21");
  assert.equal(friday.until, "2026-09-27");
  assert.equal(friday.time_zone, "America/Chicago");

  // Monday 2026-10-05 08:00 Chicago. The week that just ended.
  const monday = lastFullWeek(new Date("2026-10-05T13:00:00Z"));
  assert.equal(monday.since, "2026-09-28");
  assert.equal(monday.until, "2026-10-04");

  // Still Sunday evening in Chicago, so that week is not full yet.
  const sundayNight = lastFullWeek(new Date("2026-10-05T04:30:00Z"));
  assert.equal(sundayNight.since, "2026-09-21");
  assert.equal(sundayNight.until, "2026-09-27");

  // Monday just after midnight Chicago.
  const mondayEarly = lastFullWeek(new Date("2026-10-05T05:30:00Z"));
  assert.equal(mondayEarly.since, "2026-09-28");
  assert.equal(mondayEarly.until, "2026-10-04");
});

test("week math holds across the new year and the spring time change", () => {
  // Thursday 2026-01-01 noon Chicago (CST, UTC-6).
  const newYear = lastFullWeek(new Date("2026-01-01T18:00:00Z"));
  assert.equal(newYear.since, "2025-12-22");
  assert.equal(newYear.until, "2025-12-28");

  // Monday 2026-01-05 09:00 Chicago.
  const firstMonday = lastFullWeek(new Date("2026-01-05T15:00:00Z"));
  assert.equal(firstMonday.since, "2025-12-29");
  assert.equal(firstMonday.until, "2026-01-04");

  // Sunday 2026-03-08 23:30 Chicago, after the spring-forward hour.
  const dst = lastFullWeek(new Date("2026-03-09T04:30:00Z"));
  assert.equal(dst.since, "2026-02-23");
  assert.equal(dst.until, "2026-03-01");
});

test("explicit dates are validated and bounded", () => {
  const ok = resolveCallWindow({ since: "2026-01-01", until: "2026-03-31" });
  assert.ok(isCallWindow(ok));
  assert.equal(ok.since, "2026-01-01");
  assert.equal(ok.until, "2026-03-31");

  assert.deepEqual(resolveCallWindow({ since: "2026-09-21", until: null }), {
    error: "since and until must be provided together as YYYY-MM-DD",
  });
  assert.equal("error" in resolveCallWindow({ since: "2026-02-31", until: "2026-03-01" }), true);
  assert.equal("error" in resolveCallWindow({ since: "09/21/2026", until: "2026-09-27" }), true);
  assert.equal(
    "error" in resolveCallWindow({ since: "2026-09-21' OR '1'='1", until: "2026-09-27" }),
    true,
  );
  const reversed = resolveCallWindow({ since: "2026-09-28", until: "2026-09-21" });
  assert.equal(isCallWindow(reversed), false);
  if (!isCallWindow(reversed)) assert.equal(reversed.error, "since must be on or before until");
  const tooLong = resolveCallWindow({ since: "2026-01-01", until: "2026-04-01" });
  assert.equal("error" in tooLong, true);
});

// --- Aggregation ------------------------------------------------------------

test("calls aggregate answered, missed, and duration without passing through raw fields", () => {
  const sentinel = "SHOULD_NOT_LEAK";
  const aggregate = aggregateCalls([
    {
      callView: {
        startCallDateTime: "2026-09-21 09:00:00",
        callDurationSeconds: "30",
        callStatus: "RECEIVED",
        callTrackingDisplayLocation: "AD",
        type: "MOBILE_CLICK_TO_CALL",
        callerAreaCode: sentinel,
        callerCountryCode: sentinel,
      },
      campaign: { id: "10", name: "Search" },
    },
    {
      callView: {
        startCallDateTime: "2026-09-21 15:00:00",
        callDurationSeconds: "90",
        callStatus: "received",
        callTrackingDisplayLocation: "LANDING_PAGE",
        type: "MANUALLY_DIALED",
      },
      campaign: { id: 10, name: "Search" },
    },
    {
      callView: {
        startCallDateTime: "2026-09-22 11:00:00",
        callDurationSeconds: "40",
        callStatus: "MISSED",
        callTrackingDisplayLocation: "AD",
        type: "HIGH_END_MOBILE_SEARCH",
      },
      campaign: { id: "20", name: "Brand" },
    },
    {
      callView: {
        startCallDateTime: "2026-09-22 12:00:00",
        callDurationSeconds: "15",
        callStatus: "UNKNOWN",
        callTrackingDisplayLocation: "AD",
        type: "UNKNOWN",
      },
      campaign: { id: "20", name: "Brand" },
    },
  ]);

  assert.deepEqual(aggregate.totals, {
    total: 4,
    answered: 2,
    missed: 1,
    other: 1,
    answered_duration_seconds: 120,
    answered_avg_duration_seconds: 60,
  });
  assert.equal(aggregate.by_campaign[0]?.campaign_id, "10");
  assert.equal(aggregate.by_campaign[0]?.answered_duration_seconds, 120);
  assert.equal(aggregate.by_campaign[1]?.campaign_id, "20");
  assert.equal(aggregate.by_campaign[1]?.missed, 1);
  assert.deepEqual(
    aggregate.by_day.map((day) => [day.date, day.total, day.answered, day.missed, day.other]),
    [
      ["2026-09-21", 2, 2, 0, 0],
      ["2026-09-22", 2, 0, 1, 1],
    ],
  );
  assert.equal(JSON.stringify(aggregate).includes(sentinel), false);
  assert.equal(
    aggregate.totals.answered + aggregate.totals.missed + aggregate.totals.other,
    aggregate.totals.total,
  );
});

test("a missed call does not add duration, and an unreadable day is omitted from the day list", () => {
  const aggregate = aggregateCalls([
    {
      callView: {
        startCallDateTime: "not-a-date",
        callDurationSeconds: "80",
        callStatus: "MISSED",
      },
      campaign: { id: "10", name: "Search" },
    },
  ]);
  assert.equal(aggregate.totals.answered_duration_seconds, 0);
  assert.equal(aggregate.totals.answered_avg_duration_seconds, null);
  assert.equal(aggregate.totals.missed, 1);
  assert.deepEqual(aggregate.by_day, []);
});

test("lead form submissions are counted by id and the ids are not returned", () => {
  const count = countLeadFormSubmissions([
    { leadFormSubmissionData: { id: "form-a" } },
    { leadFormSubmissionData: { id: "form-a" } },
    { leadFormSubmissionData: { id: "form-b" } },
    { leadFormSubmissionData: {} },
  ]);
  assert.equal(count, 3);
});

test("phone_calls and call conversions roll up by campaign", () => {
  const report = toCallReport({
    ...baseReport,
    callRows: [
      {
        callView: {
          startCallDateTime: "2026-09-21 09:00:00",
          callDurationSeconds: "10",
          callStatus: "RECEIVED",
        },
        campaign: { id: "10", name: "Search" },
      },
    ],
    phoneRows: [
      { campaign: { id: "10", name: "Search" }, metrics: { phoneCalls: "4" } },
      { campaign: { id: "20", name: "Brand" }, metrics: { phoneCalls: "1" } },
    ],
    conversionRows: [
      { campaign: { id: "10", name: "Search" }, metrics: { conversions: "2" } },
      { campaign: { id: "10", name: "Search" }, metrics: { conversions: 0.5 } },
    ],
  });
  assert.equal(report.phone_calls, 5);
  assert.equal(report.call_conversions, 2.5);
  assert.deepEqual(report.metrics_by_campaign, [
    { campaign_id: "10", campaign_name: "Search", phone_calls: 4, call_conversions: 2.5 },
    { campaign_id: "20", campaign_name: "Brand", phone_calls: 1, call_conversions: 0 },
  ]);
  assert.equal(report.metrics_error, null);
  assert.equal(report.call_reporting_ok, true);
});

// --- Empty state ------------------------------------------------------------

test("an empty call_view is not reported or stored as zero calls", () => {
  const report = toCallReport({
    ...baseReport,
    leadRows: [{ leadFormSubmissionData: { id: "form-a" } }],
    phoneRows: [{ campaign: { id: "10", name: "Search" }, metrics: { phoneCalls: "2" } }],
  });
  assert.equal(report.call_reporting_ok, false);
  assert.equal(report.detail, CALL_REPORTING_OFF_DETAIL);
  assert.match(report.detail, /Admin > Account settings > Call reporting/);
  assert.equal(report.calls, null);
  assert.equal(report.calls_by_campaign, null);
  assert.equal(report.calls_by_day, null);
  assert.equal(report.lead_form_submissions, 1);
  assert.equal(report.phone_calls, 2);

  const snapshot = weeklySnapshot(report);
  assert.equal(snapshot.total_calls, null);
  assert.equal(snapshot.answered_calls, null);
  assert.equal(snapshot.missed_calls, null);
  assert.equal(snapshot.other_calls, null);
  assert.equal(snapshot.answered_duration_seconds, null);
  assert.equal(snapshot.answered_avg_duration_seconds, null);
  assert.equal(snapshot.calls_by_campaign, null);
  assert.equal(snapshot.calls_by_day, null);
  assert.equal(snapshot.phone_calls, 2);
  assert.equal(snapshot.week_start, "2026-09-21");
  assert.equal(snapshot.customer_id, "1234567890");
});

test("a call_view failure stays distinct from the call-reporting setting", () => {
  const report = toCallReport({
    ...baseReport,
    callRows: null,
    callError: "Google Ads query failed (503)",
  });
  assert.equal(report.call_reporting_ok, false);
  assert.equal(report.calls, null);
  assert.equal(report.detail, "Google Ads query failed (503)");
  assert.doesNotMatch(report.detail, /Call reporting/);
});

test("a populated week stores counts that satisfy the snapshot check", () => {
  const report = toCallReport({
    ...baseReport,
    callRows: [
      {
        callView: {
          startCallDateTime: "2026-09-23 08:00:00",
          callDurationSeconds: "45",
          callStatus: "RECEIVED",
        },
        campaign: { id: "10", name: "Search" },
      },
    ],
  });
  const snapshot = weeklySnapshot(report);
  assert.equal(snapshot.call_reporting_ok, true);
  assert.equal(snapshot.total_calls, 1);
  assert.equal(snapshot.answered_calls, 1);
  assert.equal(snapshot.missed_calls, 0);
  assert.equal(snapshot.other_calls, 0);
  assert.equal(snapshot.answered_duration_seconds, 45);
  assert.equal(snapshot.answered_avg_duration_seconds, 45);
  assert.ok(snapshot.calls_by_campaign);
  assert.ok(snapshot.calls_by_day);
  const calls = snapshot.total_calls ?? 0;
  const parts =
    (snapshot.answered_calls ?? 0) + (snapshot.missed_calls ?? 0) + (snapshot.other_calls ?? 0);
  assert.equal(parts, calls);
});

// --- Auth and read-only wiring ----------------------------------------------

test("the cron route authorizes the shared bearer before any Ads work", () => {
  const authAt = routeSource.indexOf("authorizeCron(request)");
  const configAt = routeSource.indexOf("adsConfigError()");
  const pullAt = routeSource.indexOf("pullAdsCallReport");
  assert.ok(authAt >= 0, "missing cron authorization");
  assert.ok(configAt > authAt, "config check must follow auth");
  assert.ok(pullAt > authAt, "the Ads pull must follow auth");
  assert.match(routeSource, /if \(denied\) return denied/);
  assert.match(routeSource, /GET:[\s\S]*handle\(request\)/);
  assert.match(routeSource, /POST:[\s\S]*handle\(request\)/);
  assert.doesNotMatch(routeSource, /adsMutate|sendOutbound|enqueueJob|sendSms/);
});

test("the pull reuses adsSearch, upserts weekly aggregates, and records call_reporting health", () => {
  const imported = serverSource.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/client\.server["']/);
  assert.ok(imported, "expected an ads client import");
  const names = (imported[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort();
  assert.deepEqual(names, ["adsCustomerId", "adsSearch"]);
  assert.doesNotMatch(
    serverSource,
    /adsMutate|:mutate|process\.env|sendOutbound|enqueueJob|sendSms/,
  );
  assert.match(serverSource, /\.from\("ads_call_weekly"\)/);
  assert.match(serverSource, /onConflict:\s*"week_start,customer_id"/);
  assert.match(serverSource, /provider:\s*"google_ads"/);
  assert.match(serverSource, /checkName:\s*"call_reporting"/);
});

test("call report sources never name caller fields", () => {
  for (const [name, source] of [
    ["call-report.ts", reportSource],
    ["call-report.server.ts", serverSource],
    ["ads-calls.ts", routeSource],
    ["migration", migration],
  ] as const) {
    assert.doesNotMatch(
      source,
      /caller_area_code|caller_country_code|callerAreaCode|callerCountryCode/,
      name,
    );
  }
});

test("the weekly snapshot migration is staff-read, service-role write, and unscheduled", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ads_call_weekly/);
  assert.match(migration, /UNIQUE \(week_start, customer_id\)/);
  assert.match(migration, /ALTER TABLE public\.ads_call_weekly ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /CREATE POLICY "ads_call_weekly_staff_select" ON public\.ads_call_weekly\s+FOR SELECT TO authenticated USING \(public\.is_staff\(auth\.uid\(\)\)\)/,
  );
  assert.match(migration, /GRANT SELECT ON public\.ads_call_weekly TO authenticated/);
  assert.match(migration, /GRANT ALL ON public\.ads_call_weekly TO service_role/);
  assert.match(migration, /REVOKE ALL ON public\.ads_call_weekly FROM anon/);
  assert.doesNotMatch(migration, /FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/i);
  assert.doesNotMatch(migration, /cron\.schedule/);
  assert.doesNotMatch(migration, /caller_/);
});
