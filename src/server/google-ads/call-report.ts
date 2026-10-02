// Pure Google Ads call-report math. No secrets, no I/O, no imports.
//
// Dates are America/Chicago calendar days. GAQL is built only from validated
// YYYY-MM-DD literals. The result is counts and durations; raw rows stay here.

export const REPORTING_TIME_ZONE = "America/Chicago" as const;
export const MAX_CALL_WINDOW_DAYS = 90;

/** Shown when call_view is empty so a missing setting is not reported as zero calls. */
export const CALL_REPORTING_OFF_DETAIL =
  "call_view returned no rows. Call reporting may be off in Google Ads (Admin > Account settings > Call reporting).";

export type CallWindow = {
  since: string;
  until: string;
  time_zone: typeof REPORTING_TIME_ZONE;
};

export type CallTotals = {
  total: number;
  answered: number;
  missed: number;
  other: number;
  answered_duration_seconds: number;
  answered_avg_duration_seconds: number | null;
};

export type CampaignCalls = {
  campaign_id: string;
  campaign_name: string;
  total: number;
  answered: number;
  missed: number;
  other: number;
  answered_duration_seconds: number;
};

export type DayCalls = {
  date: string;
  total: number;
  answered: number;
  missed: number;
  other: number;
};

export type CallAggregate = {
  totals: CallTotals;
  by_campaign: CampaignCalls[];
  by_day: DayCalls[];
};

export type MetricsByCampaign = {
  campaign_id: string;
  campaign_name: string;
  phone_calls: number | null;
  call_conversions: number | null;
};

export type AdsCallReport = {
  period: CallWindow;
  customer_id: string;
  call_reporting_ok: boolean;
  detail: string;
  calls: CallTotals | null;
  calls_by_campaign: CampaignCalls[] | null;
  calls_by_day: DayCalls[] | null;
  lead_form_submissions: number | null;
  lead_form_error: string | null;
  phone_calls: number | null;
  call_conversions: number | null;
  metrics_by_campaign: MetricsByCampaign[] | null;
  metrics_error: string | null;
  stored: boolean;
  generated_at: string;
};

export type AdsCallWeeklySnapshot = {
  week_start: string;
  week_end: string;
  customer_id: string;
  call_reporting_ok: boolean;
  detail: string;
  total_calls: number | null;
  answered_calls: number | null;
  missed_calls: number | null;
  other_calls: number | null;
  answered_duration_seconds: number | null;
  answered_avg_duration_seconds: number | null;
  calls_by_campaign: CampaignCalls[] | null;
  calls_by_day: DayCalls[] | null;
  lead_form_submissions: number | null;
  phone_calls: number | null;
  call_conversions: number | null;
  metrics_by_campaign: MetricsByCampaign[] | null;
};

type Bucket = {
  total: number;
  answered: number;
  missed: number;
  other: number;
  answered_duration_seconds: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function calendarDateInTimeZone(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Monday = 1 … Sunday = 7 for a YYYY-MM-DD calendar date. */
function isoWeekday(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) + deltaDays * 86_400_000,
  );
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function assertDateLiteral(value: string): string {
  if (!isRealDate(value)) throw new Error("Invalid reporting date");
  return value;
}

function daysInclusive(since: string, until: string): number {
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Last Monday–Sunday week that has fully ended in America/Chicago. */
export function lastFullWeek(now: Date): CallWindow {
  const today = calendarDateInTimeZone(REPORTING_TIME_ZONE, now);
  const currentMonday = shiftIsoDate(today, -(isoWeekday(today) - 1));
  return {
    since: shiftIsoDate(currentMonday, -7),
    until: shiftIsoDate(currentMonday, -1),
    time_zone: REPORTING_TIME_ZONE,
  };
}

export function resolveCallWindow(args: {
  since?: string | null;
  until?: string | null;
  now?: Date;
}): CallWindow | { error: string } {
  const since = args.since?.trim() ?? "";
  const until = args.until?.trim() ?? "";
  if (!since && !until) return lastFullWeek(args.now ?? new Date());
  if (!since || !until) {
    return { error: "since and until must be provided together as YYYY-MM-DD" };
  }
  if (!isRealDate(since) || !isRealDate(until)) {
    return { error: "since and until must be real dates in YYYY-MM-DD" };
  }
  if (since > until) return { error: "since must be on or before until" };
  if (daysInclusive(since, until) > MAX_CALL_WINDOW_DAYS) {
    return { error: `the date window must be ${MAX_CALL_WINDOW_DAYS} days or fewer` };
  }
  return { since, until, time_zone: REPORTING_TIME_ZONE };
}

export function isCallWindow(value: CallWindow | { error: string }): value is CallWindow {
  return !("error" in value);
}

function dateTimeBounds(window: CallWindow): { start: string; endExclusive: string } {
  const since = assertDateLiteral(window.since);
  const until = assertDateLiteral(window.until);
  return {
    start: `${since} 00:00:00`,
    endExclusive: `${shiftIsoDate(until, 1)} 00:00:00`,
  };
}

function dateBetween(window: CallWindow): string {
  const since = assertDateLiteral(window.since);
  const until = assertDateLiteral(window.until);
  return `segments.date BETWEEN '${since}' AND '${until}'`;
}

/** Fixed call_view read. Caller fields are not part of this query. */
export function callViewQuery(window: CallWindow): string {
  const bounds = dateTimeBounds(window);
  return `SELECT call_view.start_call_date_time,
            call_view.call_duration_seconds,
            call_view.call_status,
            call_view.call_tracking_display_location,
            call_view.type,
            campaign.id,
            campaign.name
     FROM call_view
     WHERE call_view.start_call_date_time >= '${bounds.start}'
       AND call_view.start_call_date_time < '${bounds.endExclusive}'`;
}

/** Count lead-form submissions by id. Form field values are not selected. */
export function leadFormCountQuery(window: CallWindow): string {
  const bounds = dateTimeBounds(window);
  return `SELECT lead_form_submission_data.id
     FROM lead_form_submission_data
     WHERE lead_form_submission_data.submission_date_time >= '${bounds.start}'
       AND lead_form_submission_data.submission_date_time < '${bounds.endExclusive}'`;
}

export function phoneCallsQuery(window: CallWindow): string {
  return `SELECT campaign.id,
            campaign.name,
            metrics.phone_calls
     FROM campaign
     WHERE ${dateBetween(window)}
       AND metrics.phone_calls > 0`;
}

export function callConversionsQuery(window: CallWindow): string {
  return `SELECT campaign.id,
            campaign.name,
            segments.conversion_action_category,
            metrics.conversions
     FROM campaign
     WHERE ${dateBetween(window)}
       AND segments.conversion_action_category = 'PHONE_CALL_LEAD'`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function whole(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function metric(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

function clipName(value: string): string {
  return value.length > 200 ? value.slice(0, 200) : value;
}

function callDay(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value));
  const day = match?.[1];
  return day && isRealDate(day) ? day : null;
}

function emptyBucket(): Bucket {
  return { total: 0, answered: 0, missed: 0, other: 0, answered_duration_seconds: 0 };
}

function addStatus(bucket: Bucket, status: string, duration: number): void {
  bucket.total += 1;
  if (status === "RECEIVED") {
    bucket.answered += 1;
    bucket.answered_duration_seconds += duration;
    return;
  }
  if (status === "MISSED") {
    bucket.missed += 1;
    return;
  }
  bucket.other += 1;
}

function averageDuration(totalSeconds: number, answered: number): number | null {
  if (answered <= 0) return null;
  return Math.round((totalSeconds / answered) * 10) / 10;
}

function toTotals(bucket: Bucket): CallTotals {
  return {
    total: bucket.total,
    answered: bucket.answered,
    missed: bucket.missed,
    other: bucket.other,
    answered_duration_seconds: bucket.answered_duration_seconds,
    answered_avg_duration_seconds: averageDuration(
      bucket.answered_duration_seconds,
      bucket.answered,
    ),
  };
}

export function aggregateCalls(rows: readonly unknown[]): CallAggregate {
  const totals = emptyBucket();
  const campaigns = new Map<string, Bucket & { campaign_name: string }>();
  const days = new Map<string, Bucket>();

  for (const raw of rows) {
    const row = asRecord(raw);
    const call = asRecord(row?.["callView"]);
    const campaign = asRecord(row?.["campaign"]);
    const status = text(call?.["callStatus"]).toUpperCase();
    const duration = status === "RECEIVED" ? whole(call?.["callDurationSeconds"]) : 0;
    addStatus(totals, status, duration);

    const campaignId = text(campaign?.["id"]) || "unknown";
    const campaignName = clipName(text(campaign?.["name"]));
    const campaignBucket = campaigns.get(campaignId) ?? {
      ...emptyBucket(),
      campaign_name: campaignName,
    };
    if (!campaignBucket.campaign_name && campaignName) campaignBucket.campaign_name = campaignName;
    addStatus(campaignBucket, status, duration);
    campaigns.set(campaignId, campaignBucket);

    const day = callDay(call?.["startCallDateTime"]);
    if (day) {
      const dayBucket = days.get(day) ?? emptyBucket();
      addStatus(dayBucket, status, duration);
      days.set(day, dayBucket);
    }
  }

  const by_campaign = [...campaigns.entries()]
    .map(([campaign_id, bucket]) => ({
      campaign_id,
      campaign_name: bucket.campaign_name,
      total: bucket.total,
      answered: bucket.answered,
      missed: bucket.missed,
      other: bucket.other,
      answered_duration_seconds: bucket.answered_duration_seconds,
    }))
    .sort((a, b) => b.total - a.total || a.campaign_id.localeCompare(b.campaign_id));

  const by_day = [...days.entries()]
    .map(([date, bucket]) => ({
      date,
      total: bucket.total,
      answered: bucket.answered,
      missed: bucket.missed,
      other: bucket.other,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totals: toTotals(totals), by_campaign, by_day };
}

export function countLeadFormSubmissions(rows: readonly unknown[]): number {
  const ids = new Set<string>();
  let withoutId = 0;
  for (const raw of rows) {
    const data = asRecord(asRecord(raw)?.["leadFormSubmissionData"]);
    const id = text(data?.["id"]);
    if (id) ids.add(id);
    else withoutId += 1;
  }
  return ids.size + withoutId;
}

type CampaignMetric = { campaign_name: string; value: number };

function campaignMetrics(
  rows: readonly unknown[],
  metricKey: "phoneCalls" | "conversions",
): {
  total: number;
  byCampaign: Map<string, CampaignMetric>;
} {
  const byCampaign = new Map<string, CampaignMetric>();
  const read = metricKey === "phoneCalls" ? whole : metric;
  let total = 0;
  for (const raw of rows) {
    const row = asRecord(raw);
    const campaign = asRecord(row?.["campaign"]);
    const metrics = asRecord(row?.["metrics"]);
    const value = read(metrics?.[metricKey]);
    total = metricKey === "phoneCalls" ? total + value : metric(total + value);
    const campaignId = text(campaign?.["id"]) || "unknown";
    const campaignName = clipName(text(campaign?.["name"]));
    const existing = byCampaign.get(campaignId);
    if (existing) {
      existing.value = metric(existing.value + value);
      if (!existing.campaign_name && campaignName) existing.campaign_name = campaignName;
    } else {
      byCampaign.set(campaignId, { campaign_name: campaignName, value });
    }
  }
  return { total, byCampaign };
}

function mergeMetrics(
  phone: { total: number; byCampaign: Map<string, CampaignMetric> } | null,
  conversions: { total: number; byCampaign: Map<string, CampaignMetric> } | null,
): MetricsByCampaign[] | null {
  if (!phone && !conversions) return null;
  const merged = new Map<string, MetricsByCampaign>();
  if (phone) {
    for (const [campaignId, row] of phone.byCampaign) {
      if (row.value === 0) continue;
      merged.set(campaignId, {
        campaign_id: campaignId,
        campaign_name: row.campaign_name,
        phone_calls: row.value,
        call_conversions: conversions ? 0 : null,
      });
    }
  }
  if (conversions) {
    for (const [campaignId, row] of conversions.byCampaign) {
      if (row.value === 0) continue;
      const existing = merged.get(campaignId);
      if (existing) {
        existing.call_conversions = row.value;
        if (!existing.campaign_name && row.campaign_name)
          existing.campaign_name = row.campaign_name;
      } else {
        merged.set(campaignId, {
          campaign_id: campaignId,
          campaign_name: row.campaign_name,
          phone_calls: phone ? 0 : null,
          call_conversions: row.value,
        });
      }
    }
  }
  return [...merged.values()].sort((a, b) => {
    const byPhone = (b.phone_calls ?? -1) - (a.phone_calls ?? -1);
    if (byPhone !== 0) return byPhone;
    const byConversions = (b.call_conversions ?? -1) - (a.call_conversions ?? -1);
    if (byConversions !== 0) return byConversions;
    return a.campaign_id.localeCompare(b.campaign_id);
  });
}

export function toCallReport(args: {
  window: CallWindow;
  customerId: string;
  callRows: readonly unknown[] | null;
  callError: string | null;
  leadRows: readonly unknown[] | null;
  leadError: string | null;
  phoneRows: readonly unknown[] | null;
  phoneError: string | null;
  conversionRows: readonly unknown[] | null;
  conversionError: string | null;
  stored: boolean;
  generatedAt: string;
}): AdsCallReport {
  let call_reporting_ok = false;
  let detail = args.callError ?? CALL_REPORTING_OFF_DETAIL;
  let calls: CallTotals | null = null;
  let calls_by_campaign: CampaignCalls[] | null = null;
  let calls_by_day: DayCalls[] | null = null;

  if (!args.callError && args.callRows && args.callRows.length > 0) {
    const aggregate = aggregateCalls(args.callRows);
    call_reporting_ok = true;
    detail = `call_view returned ${args.callRows.length} rows.`;
    calls = aggregate.totals;
    calls_by_campaign = aggregate.by_campaign;
    calls_by_day = aggregate.by_day;
  } else if (!args.callError) {
    detail = CALL_REPORTING_OFF_DETAIL;
  }

  const phone =
    args.phoneError || !args.phoneRows ? null : campaignMetrics(args.phoneRows, "phoneCalls");
  const conversions =
    args.conversionError || !args.conversionRows
      ? null
      : campaignMetrics(args.conversionRows, "conversions");
  const metricErrors = [args.phoneError, args.conversionError].filter((item): item is string =>
    Boolean(item),
  );

  return {
    period: args.window,
    customer_id: args.customerId,
    call_reporting_ok,
    detail,
    calls,
    calls_by_campaign,
    calls_by_day,
    lead_form_submissions:
      args.leadError || !args.leadRows ? null : countLeadFormSubmissions(args.leadRows),
    lead_form_error: args.leadError,
    phone_calls: phone ? phone.total : null,
    call_conversions: conversions ? conversions.total : null,
    metrics_by_campaign: mergeMetrics(phone, conversions),
    metrics_error: metricErrors.length > 0 ? metricErrors.join("; ").slice(0, 300) : null,
    stored: args.stored,
    generated_at: args.generatedAt,
  };
}

/** Table row. Empty call_view stores null call counts so a missing setting is not a stored zero. */
export function weeklySnapshot(report: AdsCallReport): AdsCallWeeklySnapshot {
  return {
    week_start: report.period.since,
    week_end: report.period.until,
    customer_id: report.customer_id,
    call_reporting_ok: report.call_reporting_ok,
    detail: report.detail.slice(0, 600),
    total_calls: report.calls?.total ?? null,
    answered_calls: report.calls?.answered ?? null,
    missed_calls: report.calls?.missed ?? null,
    other_calls: report.calls?.other ?? null,
    answered_duration_seconds: report.calls?.answered_duration_seconds ?? null,
    answered_avg_duration_seconds: report.calls?.answered_avg_duration_seconds ?? null,
    calls_by_campaign: report.calls_by_campaign,
    calls_by_day: report.calls_by_day,
    lead_form_submissions: report.lead_form_submissions,
    phone_calls: report.phone_calls,
    call_conversions: report.call_conversions,
    metrics_by_campaign: report.metrics_by_campaign,
  };
}
