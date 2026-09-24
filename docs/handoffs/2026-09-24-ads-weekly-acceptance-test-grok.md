# Handoff: run the Ads Weekly acceptance test

**For:** Grok bot (or any agent with terminal access to Fendi's machine)
**Date:** 2026-09-24
**Type:** verification only — no code changes, no Google Ads changes

---

## 1. What you are testing and why

Boltz Insight Engine has a new read-only endpoint that pulls Google Ads **Search
Terms** and **Keywords** for the Monday "Ads Weekly" report, using server-side
OAuth credentials only. It has been merged to `main` and published to Lovable.

**It has never been called against the real Google Ads account.** Every check so
far was local (unit tests, typecheck) and those cannot catch an invalid GAQL
field name or a sunset API version — a single bad field fails the entire query at
request time. Your job is to make the first real call and report exactly what
came back.

You are **not** fixing anything. Report; do not repair.

---

## 2. The one command

Run this in a terminal where `CRON_SECRET` is already set as an environment
variable (it is a Lovable Cloud secret):

```bash
curl -sS -o /tmp/ads.json -w "HTTP %{http_code}\n" -X POST \
  "https://boltz-insight-engine.lovable.app/api/public/cron/ads-weekly" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Then print the result:

```bash
python3 -m json.tool /tmp/ads.json | head -80
```

If the status code was **500**, this single line is the most important output in
the whole task:

```bash
python3 -c "import json;print(json.load(open('/tmp/ads.json')).get('detail'))"
```

### Chrome does not matter — do not spend time on it

Earlier instructions said to log out of Google Ads and close Chrome. That was to
prove the path does not depend on a signed-in browser. **A `curl` request sends no
browser cookies at all**, so it proves that inherently. Chrome may be open and
logged in; it cannot affect a server-side OAuth refresh-token call. Do not close
it, and do not treat an open Chrome as invalidating the result.

---

## 3. How to read the status code

| Code | Meaning | What to report |
|---|---|---|
| **200** | Working. Go to section 4. | The checklist in section 4 |
| **400** | Bad `days` parameter — only possible if you added `?days=`. Drop it. | n/a, just retry without it |
| **401** | `CRON_SECRET` in your shell does not match the deployed one. | Say "401" — **do not** paste either value |
| **404** | Route not in the deployed build; publish did not include the merge. | Say "404" so the publish gets redone |
| **503** | Google Ads secrets missing in Lovable Cloud. Body lists **names only**, never values. | The list of missing names |
| **500** | Provider or query failure. This is the expected first failure mode. | The full `detail` string |

A `500` is not a surprise and not a disaster — it is the outcome the whole test
exists to surface. `detail` is pre-redacted by the app and safe to share.

---

## 4. If you got 200 — verify these ten things

Check each and report pass/fail. Do not assume; look at the JSON.

1. `period.start` and `period.end` are real dates in `YYYY-MM-DD` form, and
   `end` is **yesterday** (not today) in `period.time_zone`.
2. `period.time_zone` is the Google Ads account's time zone (for Boltz, expect
   something like `America/Chicago`), **not** `UTC` as a fallback. If it says
   `UTC`, flag it — it may mean the account time zone was not read.
3. `account.customer_id` is present; `account.descriptive_name` is the real
   account name.
4. `search_terms` is an array. If non-empty, spot-check one row has:
   `search_term`, `campaign_name`, `ad_group_name`, `match_type`,
   `impressions`, `clicks`, `cost_micros`, `conversions`, `conversions_value`.
5. `keywords` is an array. If non-empty, spot-check one row has:
   `keyword_text`, `match_type`, `status`, `campaign_name`, `ad_group_name`,
   and the same five metrics.
6. **Campaign and ad-group names are non-empty strings**, not blank and not just
   numeric IDs. This is a specific acceptance requirement.
7. `summary.search_term_rows` and `summary.keyword_rows` match the actual array
   lengths.
8. `summary.truncated` is `false`. If it is `true`, the 5000-row cap was hit and
   the totals are partial — report this, and **do not** reconcile them in step 5.
9. `generated_at` is a current ISO timestamp.
10. **No secret anywhere in the body.** Search for any of: `ya29`, `refresh`,
    `client_secret`, `developer`, `Bearer`, `access_token`. Expect zero hits:

    ```bash
    grep -Eic "ya29|refresh_token|client_secret|developer.token|access_token" /tmp/ads.json
    ```

    Must print `0`. If it prints anything else, **stop and escalate immediately**
    — that is a security defect, not a reporting detail.

### An empty report is a PASS, not a failure

If the account genuinely had no Search activity in the window, `search_terms` and
`keywords` will be `[]` with zero totals and a `200`. That is a valid, correct
report by design. Say "empty but valid" — do not call it broken. Cross-check in
the Ads UI whether the account actually spent anything in that date range before
concluding anything is wrong.

---

## 5. Reconcile one week against the Google Ads UI

Only if step 4 passed and `summary.truncated` is `false`.

In the Ads UI, set the date range to **exactly** `period.start` → `period.end`
from the JSON, then compare against `summary`.

**These differences are expected and correct — do not report them as bugs:**

- `summary` totals come from `keyword_view`, so they are **keyword-attributed
  spend only**. Performance Max, Display, and Dynamic Search Ads spend is *not*
  included. If the account runs PMax, the UI's all-campaigns total will be
  **higher**, and that is correct.
- Search-term rows are a subset of the same spend and are deliberately **not**
  added into the totals (that would double count).
- Performance Max search themes live in a different resource
  (`campaign_search_term_view`) and are intentionally excluded from V1.
- `cost_micros` is in **micros**: divide by 1,000,000 for currency.

The response's own `notes` array restates these. Read it.

So: compare the UI's **keyword-level** totals (Search campaigns, keyword view)
against `summary`. Those should line up. Report any gap you cannot explain with
the four bullets above, with both numbers.

---

## 6. Hard limits — do not cross these

- **Do not modify any code**, in this repo or elsewhere. This is a read test.
- **Do not change anything in the Google Ads account** — no campaigns, budgets,
  keywords, or negative keywords. The endpoint is read-only and a change-control
  freeze is in force; there is no reason to touch the account.
- **Never paste a secret into chat** — not `CRON_SECRET`, not any `GOOGLE_ADS_*`
  value, not a token. Reference them by name only. If a `503` lists missing
  secret names, the names are fine to share; values never are.
- **Do not run the `supabase` CLI or open the Supabase dashboard.** This project
  is Lovable-managed; there is no standalone Supabase. A 403 there is a false
  wall, not a problem to solve.
- **Do not re-run more than twice.** If it fails the same way twice, that is a
  real failure — report it rather than retrying.

---

## 7. What to send back

Keep it short and literal. Paste actual output, not a summary of it.

```
STATUS CODE: <the HTTP code>

IF 500 — detail:
<the full detail string>

IF 200:
period:        start=<...> end=<...> time_zone=<...>
account:       name=<...>
row counts:    search_terms=<n> keywords=<n>
truncated:     <true|false>
summary:       impressions=<n> clicks=<n> cost_micros=<n> conversions=<n> conversions_value=<n>
secret grep:   <the number grep printed — must be 0>
checklist:     <which of the ten items in section 4 failed, or "all 10 pass">

IF reconciled:
Ads UI keyword-level totals for <start>..<end>: impressions=<n> clicks=<n> cost=<n>
Unexplained gap: <describe, or "none">
```

If anything else looked odd, say so in one or two plain sentences at the end.
Unexplained oddities are worth more than a tidy report.

---

## 8. Reference — what is actually running

Useful only if you need to interpret a `500` about a field name.

Endpoint: `POST /api/public/cron/ads-weekly`, auth
`Authorization: Bearer <CRON_SECRET>`. Source:
`src/routes/api/public/cron/ads-weekly.ts` →
`src/server/google-ads/reports.server.ts`. Google Ads REST API **v22**, via
`googleAds:searchStream`.

Three queries run per call:

1. `SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1`
2. `FROM search_term_view` selecting: `segments.date`, `campaign.id`,
   `campaign.name`, `ad_group.id`, `ad_group.name`,
   `search_term_view.search_term`, `search_term_view.status`,
   `segments.keyword.info.text`, `segments.keyword.info.match_type`,
   `metrics.impressions`, `metrics.clicks`, `metrics.cost_micros`,
   `metrics.conversions`, `metrics.conversions_value`
3. `FROM keyword_view` selecting the same, but with
   `ad_group_criterion.criterion_id`, `ad_group_criterion.keyword.text`,
   `ad_group_criterion.keyword.match_type`, `ad_group_criterion.status` in place
   of the `search_term_view` / `segments.keyword` fields

Both report queries are filtered `WHERE segments.date BETWEEN '<start>' AND '<end>'`
and capped at `LIMIT 5000`.

If `detail` names a specific field or resource, quote it verbatim — that pins the
fix immediately.
