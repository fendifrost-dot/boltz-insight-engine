# Ads Weekly — first live run (acceptance baseline)

Date: 2026-09-24
Run by: Grok bot, terminal, against the published Lovable app
Endpoint: `POST /api/public/cron/ads-weekly`
Deployed commit: `51c7c63`

**Result: PASS** on every criterion testable without Google Ads UI access.
Reconciliation against the UI is still outstanding — see "Open" below.

---

## Response

| Field | Value |
|---|---|
| status | `200` |
| `period` | `2026-09-16` → `2026-09-22`, `days=7`, `time_zone=America/Chicago` |
| `account` | `BOLTZ AUTOMOTIVE`, customer id ending `6288` |
| `search_terms` rows | 1062 |
| `keywords` rows | 431 |
| `truncated` | `false` |
| `impressions` | 2,770 |
| `clicks` | 126 |
| `cost_micros` | 342,315,572 (**$342.32**) |
| `conversions` | 28.99635 |
| `conversions_value` | 23 |
| secret scan | 0 hits |

Campaign and ad-group names came back as real strings (e.g.
`Leads-Search-1 #2` / `Ad group 1`), not blank and not numeric IDs.

## Derived ratios

| Metric | Value |
|---|---|
| CTR | 4.55% |
| Avg CPC | $2.72 |
| Conversion rate | 23.0% |
| Cost per conversion | $11.81 |
| **Value per conversion** | **$0.79** |
| **Reported ROAS** | **6.7%** |

---

## What this run proves

1. **The whole point of the exercise:** Search Terms and Keywords are retrievable
   with no signed-in browser anywhere in the path. The call carried only a bearer
   token; credentials were server-side OAuth throughout.
2. **The GAQL is valid** against this account on API `v22`. Every selected field
   resolved — the risk that a single bad field name would fail the entire query
   is now closed, and it could only ever have been closed by a live call.
3. **Account-time-zone date resolution is working, and demonstrably matters.**
   The run happened at ~00:36 UTC on 2026-09-24, which was still 2026-09-23 in
   America/Chicago. The endpoint correctly returned `end=2026-09-22` (yesterday
   *in the account's zone*). A naive UTC implementation would have returned
   `end=2026-09-23` and silently reported a different week than the Ads UI shows.
4. **No truncation.** 1062 and 431 rows sit well under the 5000-row cap, so the
   totals are complete and safe to reconcile.
5. **No secret leakage** in the response body.

## Finding worth acting on: conversion values are not meaningfully configured

`conversions_value` = **23** against **28.99635 conversions** — a reported value
of **$0.79 per conversion**, or a **6.7% ROAS** on $342.32 of spend.

Taken at face value that says the account returns 7 cents per dollar spent. For
engine replacement, a high-ticket service, that is not plausible as reality. The
far likelier reading is that conversion **values** are largely unset in the Ads
account — most conversion actions carry no value, or a nominal $1 on a subset.

This is an **account configuration gap, not a reporting bug**. The endpoint is
faithfully reporting what Google holds. But it matters directly for what this
system exists to do: Boltz's stated commercial priority is engine-replacement
growth, and `conversions_value` is the field any revenue or ROAS measurement
would rest on. Until conversion actions carry real values, `conversions_value`
should be treated as **unusable for revenue analysis**, and `conversions` (count)
plus cost-per-conversion are the only trustworthy outcome signals in this feed.

Also note a 23% conversion rate on 126 clicks is high for search. That is
consistent with call/form conversions counted generously, and is worth confirming
against which conversion actions are enabled and whether any are double-counting.

## Open

- **UI reconciliation not yet run** (blocked on `info@boltzautoinc.com` sign-in).
  This is the one remaining check that can catch numbers that are well-formed but
  semantically wrong. When run, compare the Ads UI **keyword-level** totals for
  `2026-09-16`..`2026-09-22` against `summary`.
  Expected, correct differences: totals are `keyword_view`-only, so PMax/Display/
  DSA spend is excluded; search-term rows are a subset and deliberately not added
  in; `cost_micros` is micros.
- **Monday cron trigger not wired.** The endpoint is agent-callable but not
  automatic. That scheduling config lives outside this repo.
