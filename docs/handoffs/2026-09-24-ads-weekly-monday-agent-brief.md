# Monday agent brief: consuming the Ads Weekly report

**Date:** 2026-09-24
**Status:** endpoint live, validated, reconciled exactly against the Google Ads UI
**Scheduling model:** the Monday agent **pulls**. There is no cron job and no
stored snapshot — every call queries Google live.

---

## The call

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/cron/ads-weekly" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Optional `?days=N` (integer 1–90, default 7) changes only the lookback length. The
GAQL is fixed server-side; you cannot supply query text.

Run it on Monday and the window resolves to the previous **Monday–Sunday** in the
account's time zone. Nothing to compute on your side — read `period` from the
response and quote those dates.

| Code  | Meaning                                                  |
| ----- | -------------------------------------------------------- |
| `200` | Report (possibly empty — see below)                      |
| `400` | Bad `days` value                                         |
| `401` | Wrong/missing bearer                                     |
| `503` | Google Ads secrets not configured (names only in body)   |
| `500` | Provider failure; `detail` is redacted and safe to quote |

Do not retry a `500` more than once. Report it instead.

## Reading the response

- `period.start` / `period.end` / `period.time_zone` — **always state these
  explicitly in the report.** Never say "last 7 days".
- `search_terms[]` — one row per day × campaign × ad group × search term.
- `keywords[]` — one row per day × campaign × ad group × keyword.
- `summary` — totals, plus `search_term_rows`, `keyword_rows`, `truncated`.
- `notes[]` — **read and respect these every run.** They state the live caveats.
- `cost_micros` is **micros**: divide by 1,000,000 for dollars.

**An empty report is valid.** No activity in the window yields `[]` and zero
totals with a `200`. Report "no activity in <dates>" — do not report a failure.

**If `summary.truncated` is `true`**, the 5000-row cap was hit, totals are partial,
and they must not be presented as account totals or compared to the Ads UI. Say so.

## Three things you must not get wrong

**1. Totals are keyword-attributed, not account-wide.** `summary` comes from
`keyword_view`. Performance Max, Display, and Dynamic Search Ads spend is **not**
included. If someone compares your figure to an all-campaigns total in the Ads UI
and it is lower, that is correct. Say "search-keyword spend", not "total spend".

**2. Search terms are not additive to keywords.** The two lists describe the same
spend from different angles. Never sum them — that double counts.

**3. Conversion metrics are currently NOT trustworthy. Do not report them as
performance.**

This was confirmed in the Ads account on 2026-09-24:

- All 19 conversion actions are **Primary**, so everything counts toward
  `conversions`.
- Three separate double-count mechanisms: `Clicks to call` and `Calls from ads`
  both Primary (one caller counts twice); two active call actions; map directions,
  website visits and "other engagements" each counting as full conversions,
  several _Every time_.
- Values are nominal — mostly $1 or none, bookings $5. Nothing reflects a real
  repair ticket.

So the ~~23% conversion rate seen in the first week is an **inflated counter, not
performance**, and `conversions_value` (~~$0.79 per conversion) is not revenue.

**Until conversion tracking is restructured**, treat `conversions` and
`conversions_value` as diagnostic only. If you mention them at all, label them
"unreliable — conversion tracking not yet restructured". Never compute ROAS,
cost-per-acquisition, or revenue from them, and never describe a change as having
"improved conversions".

The signals you **can** trust: `impressions`, `clicks`, `cost_micros`, and the
search-term and keyword **text** — which is the actual point of this report.

## What a useful Monday report looks like

Lead with the dates, then spend and volume, then the text analysis — which is
where the value is while conversion tracking is broken:

1. Window (`period.start`–`period.end`, and the time zone).
2. Search-keyword spend, impressions, clicks, CTR, avg CPC.
3. **Wasted-spend candidates:** search terms with cost and clicks but no
   plausible relevance to engine replacement or the serviced vehicle set. Quote
   the term, campaign, ad group, clicks and cost.
4. **Opportunity candidates:** search terms with impressions and clicks that are
   clearly relevant but are not yet keywords.
5. **Match-type observations:** broad or phrase keywords pulling in irrelevant
   terms.
6. Anything anomalous.

Items 3–5 are read-only observations. Under the README workflow they are
**findings**, which go to the Decision Queue for owner approval — they are not
changes to apply. Do not make Google Ads changes, and do not recommend applying
them automatically.

## Hard limits

- **Read-only.** This endpoint cannot mutate the Ads account and you must not
  attempt account changes through any other route.
- **Never print a secret** — not `CRON_SECRET`, not any `GOOGLE_ADS_*` value.
- **Do not call** `process-jobs`, `reconcile-messages`, or `renew-subscriptions`.
  Same bearer auth, but real side effects including sending customer messages.
- **Do not run the `supabase` CLI or open the Supabase dashboard.** Lovable-managed
  project; a 403 there is a false wall.

## Known limits of V1

- **No history.** Every call is live, so week-over-week comparison is not possible
  from this endpoint alone. If you need trend, keep your own prior reports, or a
  snapshot table can be added (V2).
- **Performance Max search themes are excluded** — they live in
  `campaign_search_term_view`, a materially different resource, deliberately not
  blended in.
- **5000-row cap per list**, flagged via `summary.truncated`.
