// Server-only Google Ads weekly reporting. Never import from client code.
//
// V1 is strictly READ-ONLY. This module intentionally imports only `adsSearch`
// (plus account metadata helpers) from the client — it must never import
// `adsMutate`. `weekly-report-readonly.test.ts` enforces that statically.
//
// The GAQL here is fixed and server-controlled: callers choose only the length
// of the lookback window (a bounded integer), never the query text. Reporting
// dates are resolved to explicit calendar dates in the *account's* time zone so
// a report reconciles against the Google Ads UI instead of drifting with the
// server's clock.
import { adsSearch, adsCustomerId } from "./client.server";
import { dateClause, resolveReportPeriod, type AdsReportPeriod } from "./report-period";

export { resolveReportPeriod, type AdsReportPeriod };

/**
 * Row cap per report. Guards against an unbounded response; when a report hits
 * the cap its totals are partial and `truncated` is set so the caller does not
 * reconcile a clipped total against the Ads UI.
 */
const ROW_LIMIT = 5000;

export type SearchTermRow = {
  date: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  search_term: string;
  search_term_status: string;
  /** Keyword the term matched against, when Google reports one. */
  keyword_text: string | null;
  match_type: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
};

export type KeywordRow = {
  date: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  criterion_id: string;
  keyword_text: string;
  match_type: string;
  status: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
};

export type MetricTotals = {
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
};

export type AdsWeeklyReport = {
  period: AdsReportPeriod;
  account: {
    customer_id: string;
    descriptive_name: string | null;
    currency_code: string | null;
  };
  search_terms: SearchTermRow[];
  keywords: KeywordRow[];
  summary: MetricTotals & {
    search_term_rows: number;
    keyword_rows: number;
    /** True when either report hit `ROW_LIMIT`; totals are then partial. */
    truncated: boolean;
  };
  /** GAQL resource behind each list, so materially different reports never blend. */
  resources: {
    search_terms: "search_term_view";
    keywords: "keyword_view";
  };
  notes: string[];
  generated_at: string;
};

// ---------------------------------------------------------------------------
// Field coercion — Google returns metrics as strings or numbers depending on type.
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function optionalStr(value: unknown): string | null {
  const s = str(value);
  return s.length > 0 ? s : null;
}

type GaqlRow = Record<string, any>;

function metricsOf(row: GaqlRow): MetricTotals {
  const m = row["metrics"] ?? {};
  return {
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    cost_micros: num(m.costMicros),
    conversions: num(m.conversions),
    conversions_value: num(m.conversionsValue),
  };
}

function emptyTotals(): MetricTotals {
  return { impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0 };
}

function addTotals(into: MetricTotals, row: MetricTotals): void {
  into.impressions += row.impressions;
  into.clicks += row.clicks;
  into.cost_micros += row.cost_micros;
  into.conversions += row.conversions;
  into.conversions_value += row.conversions_value;
}

// ---------------------------------------------------------------------------
// Account metadata
// ---------------------------------------------------------------------------

export async function getAdsAccountInfo(): Promise<{
  customer_id: string;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string;
}> {
  const rows = await adsSearch<GaqlRow>(
    "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  const customer = rows[0]?.["customer"] ?? {};
  return {
    customer_id: adsCustomerId(),
    descriptive_name: optionalStr(customer.descriptiveName),
    currency_code: optionalStr(customer.currencyCode),
    time_zone: str(customer.timeZone) || "UTC",
  };
}

// ---------------------------------------------------------------------------
// Search terms — standard Search campaigns via search_term_view.
//
// Performance Max search themes live in `campaign_search_term_view`, a
// materially different resource. It is deliberately NOT unioned in here; if
// Monday reporting needs PMax, add it as its own list with its own resource tag.
// ---------------------------------------------------------------------------

export async function getWeeklySearchTerms(
  period: AdsReportPeriod,
): Promise<{ rows: SearchTermRow[]; totals: MetricTotals; truncated: boolean }> {
  const raw = await adsSearch<GaqlRow>(
    `SELECT segments.date,
            campaign.id,
            campaign.name,
            ad_group.id,
            ad_group.name,
            search_term_view.search_term,
            search_term_view.status,
            segments.keyword.info.text,
            segments.keyword.info.match_type,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
     FROM search_term_view
     WHERE ${dateClause(period)}
     ORDER BY metrics.cost_micros DESC
     LIMIT ${ROW_LIMIT}`,
  );

  const totals = emptyTotals();
  const rows = raw.map((r) => {
    const m = metricsOf(r);
    addTotals(totals, m);
    const keyword = r["segments"]?.keyword?.info ?? {};
    return {
      date: str(r["segments"]?.date),
      campaign_id: str(r["campaign"]?.id),
      campaign_name: str(r["campaign"]?.name),
      ad_group_id: str(r["adGroup"]?.id),
      ad_group_name: str(r["adGroup"]?.name),
      search_term: str(r["searchTermView"]?.searchTerm),
      search_term_status: str(r["searchTermView"]?.status),
      keyword_text: optionalStr(keyword.text),
      match_type: optionalStr(keyword.matchType),
      ...m,
    } satisfies SearchTermRow;
  });

  return { rows, totals, truncated: raw.length >= ROW_LIMIT };
}

// ---------------------------------------------------------------------------
// Keywords — keyword_view.
// ---------------------------------------------------------------------------

export async function getWeeklyKeywords(
  period: AdsReportPeriod,
): Promise<{ rows: KeywordRow[]; totals: MetricTotals; truncated: boolean }> {
  const raw = await adsSearch<GaqlRow>(
    `SELECT segments.date,
            campaign.id,
            campaign.name,
            ad_group.id,
            ad_group.name,
            ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.status,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
     FROM keyword_view
     WHERE ${dateClause(period)}
     ORDER BY metrics.cost_micros DESC
     LIMIT ${ROW_LIMIT}`,
  );

  const totals = emptyTotals();
  const rows = raw.map((r) => {
    const m = metricsOf(r);
    addTotals(totals, m);
    const criterion = r["adGroupCriterion"] ?? {};
    return {
      date: str(r["segments"]?.date),
      campaign_id: str(r["campaign"]?.id),
      campaign_name: str(r["campaign"]?.name),
      ad_group_id: str(r["adGroup"]?.id),
      ad_group_name: str(r["adGroup"]?.name),
      criterion_id: str(criterion.criterionId),
      keyword_text: str(criterion.keyword?.text),
      match_type: str(criterion.keyword?.matchType),
      status: str(criterion.status),
      ...m,
    } satisfies KeywordRow;
  });

  return { rows, totals, truncated: raw.length >= ROW_LIMIT };
}

// ---------------------------------------------------------------------------
// Combined weekly report
// ---------------------------------------------------------------------------

/**
 * The Monday "Ads Weekly" payload. Read-only.
 *
 * An account with no activity in the window yields empty lists and zero
 * totals — that is a valid report, not an error. Only auth/config/transport
 * failures throw, and those messages are already provider-redacted.
 */
export async function getAdsWeeklyReport(
  opts: { days?: number | undefined; now?: Date | undefined } = {},
): Promise<AdsWeeklyReport> {
  const account = await getAdsAccountInfo();
  const period = resolveReportPeriod({
    timeZone: account.time_zone,
    days: opts.days,
    now: opts.now,
  });

  const [searchTerms, keywords] = await Promise.all([
    getWeeklySearchTerms(period),
    getWeeklyKeywords(period),
  ]);

  // Search terms and keywords both roll up the same underlying clicks, so
  // summing them would double count. Keyword totals are the account-level
  // reference; search-term totals are a subset (terms Google chose to report).
  const totals = keywords.totals;
  const truncated = searchTerms.truncated || keywords.truncated;

  const notes: string[] = [
    "Summary totals are from keyword_view. Search-term rows are a subset of the same spend and are not added to the totals.",
    "search_term_view covers standard Search campaigns only. Performance Max search themes are in campaign_search_term_view and are not included.",
  ];
  if (truncated) {
    notes.push(
      `Row cap of ${ROW_LIMIT} reached; totals are partial and must not be reconciled against the Ads UI.`,
    );
  }

  return {
    period,
    account: {
      customer_id: account.customer_id,
      descriptive_name: account.descriptive_name,
      currency_code: account.currency_code,
    },
    search_terms: searchTerms.rows,
    keywords: keywords.rows,
    summary: {
      ...totals,
      search_term_rows: searchTerms.rows.length,
      keyword_rows: keywords.rows.length,
      truncated,
    },
    resources: {
      search_terms: "search_term_view",
      keywords: "keyword_view",
    },
    notes,
    generated_at: new Date().toISOString(),
  };
}
