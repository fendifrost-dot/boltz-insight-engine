# Handoff: reconcile Ads Weekly against the Google Ads UI

**For:** Grok bot
**Date:** 2026-09-24
**Type:** read-only comparison — no code changes, no Google Ads changes
**Prerequisite:** signed in to Google Ads as `info@boltzautoinc.com`

---

## 1. What you are doing and why it matters

The Ads Weekly endpoint already returned a valid `200` with real data. What is
**not** yet established is whether those numbers are *correct*. A report can be
perfectly well-formed and still wrong — wrong date window, wrong aggregation,
double-counted rows. This comparison is the only check that catches that class of
error.

You are comparing one week of API output against the same week in the Ads UI.

**Report differences; do not fix anything.**

---

## 2. The numbers to compare against

From the live run on 2026-09-24 (deployed commit `51c7c63`):

| Field | Value |
|---|---|
| Window | **2026-09-16 → 2026-09-22** inclusive |
| Account | BOLTZ AUTOMOTIVE (customer id ends `6288`) |
| Impressions | **2,770** |
| Clicks | **126** |
| Cost | **$342.32** (`cost_micros` 342,315,572) |
| Conversions | **28.99635** |
| Conversions value | **23** |
| Keyword rows | 431 |
| Search-term rows | 1,062 |

Optionally re-run the endpoint first to confirm the same window still returns the
same totals (it should — the window is historical and closed):

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/cron/ads-weekly" \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(d['period']); print(d['summary'])"
```

---

## 3. Set up the UI view correctly — this is where the comparison goes wrong

The API totals come from the **`keyword_view`** resource. To compare
like-for-like you must put the UI into the equivalent view. Getting this wrong
produces a large phantom discrepancy.

1. **Date range: custom, exactly `2026-09-16` to `2026-09-22`.** Not "last 7
   days" — that is a moving window and will not match.
2. Go to the **Keywords → Search keywords** view (not Campaigns, not Overview).
3. Make sure **no campaign filter** is applied, and that **paused/removed
   keywords are included** — the API does not filter by status, so the UI must
   not either.
4. Read the **totals row** for: Impr., Clicks, Cost, Conversions, Conv. value.

Record those five numbers.

---

## 4. Differences that are expected and correct

**Do not report these as bugs.** Each is a deliberate design decision:

- **Search-keyword totals only.** The API totals are `keyword_view`. If you look
  at an all-campaigns total instead, Performance Max, Display, and Dynamic Search
  Ads spend is included there and **not** in the API number, so the UI figure
  will be **higher**. That is correct.
- **Search terms are not added in.** The 1,062 search-term rows describe the same
  spend as the keyword rows. Summing both would double count, so `summary` counts
  only keywords.
- **Cost is in micros.** Divide `cost_micros` by 1,000,000.
- **Fractional conversions are normal** (28.99635). Google attributes
  fractionally; this is not a rounding bug.
- **Small conversion drift.** Conversion counts can shift slightly after the fact
  as attribution settles. A sub-1% difference in conversions is not a defect.

## 5. Differences that ARE defects — report immediately

- Impressions or clicks off by **more than ~1%**. These are settled metrics for a
  closed week and should match closely.
- Cost off by more than ~1%.
- The UI's search-keyword totals being **lower** than the API's. The API is a
  subset of account activity, so it should never exceed the matching UI view.
- Date window mismatch — if the UI's `2026-09-16`..`2026-09-22` clearly covers a
  different set of days than the report claims.

## 6. Also worth a look while you are in there

Separate from reconciliation, the live run flagged a likely account
configuration gap: **`conversions_value` = 23 against ~29 conversions**, i.e.
about **$0.79 per conversion** on **$342.32** of spend.

While signed in, check **Goals → Conversions → Summary**:

1. Which conversion actions are enabled?
2. Do they have **values** assigned, or are most value-less / set to a nominal $1?
3. Are any plausibly **double-counting** (a 23% conversion rate on 126 clicks is
   high for search)?

Report what you see. Do not change any conversion action settings.

---

## 7. Hard limits

- **No code changes.** This is a read-only comparison.
- **No changes in Google Ads** — no campaigns, budgets, keywords, negatives, bids,
  or conversion settings. A change-control freeze is in force. You are reading only.
- **Never paste a secret** — not `CRON_SECRET`, not any `GOOGLE_ADS_*` value.
- **Do not call** `process-jobs`, `reconcile-messages`, or `renew-subscriptions`.
  They share the same auth but have real side effects, including sending messages.
- **Do not run the `supabase` CLI or open the Supabase dashboard.** This project is
  Lovable-managed; a 403 there is a false wall.

## 8. Report back in this format

```
UI VIEW USED: Keywords > Search keywords, custom range 2026-09-16..2026-09-22,
              no campaign filter, paused/removed included  (confirm or describe what differed)

                    API             UI              DELTA
impressions         2770            <n>             <n / %>
clicks              126             <n>             <n / %>
cost                $342.32         <n>             <n / %>
conversions         28.99635        <n>             <n / %>
conversions_value   23              <n>             <n / %>

VERDICT: <reconciles | discrepancy>
If discrepancy: which metric, how large, and whether section 4 explains it.

CONVERSION SETUP (section 6):
actions enabled:    <list>
values assigned:    <yes / no / partial — describe>
double-count risk:  <what you saw>

ANYTHING ELSE ODD: <one or two plain sentences, or "none">
```

An honest "I could not make the UI view match section 3" is more useful than a
forced comparison. Say so if that happens.
