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

## UI reconciliation — PASS, exact

Run 2026-09-24 by Grok bot, signed in as `info@boltzautoinc.com`. UI view:
Keywords → Search keywords, custom range Sep 16–22 2026, all campaigns, no filter
chip, keyword status = All ("Show all keywords" on).

| Metric | API | UI | Delta |
|---|---|---|---|
| impressions | 2,770 | 2,770 | **0** |
| clicks | 126 | 126 | **0** |
| cost | $342.32 | $342.32 | **0** |
| conversions | 28.99635 | 29.00 | **0** (UI rounds to 2dp) |
| conversions_value | 23 | 23.00 | **0** |

Zero delta on all five. No Performance Max, AI Max, or URL-inclusion spend landed
in this window, so the keyword-view-vs-account-total gap this report warned about
did not arise here — both totals were identical. **That gap will appear the moment
PMax spend starts**, and it will be correct, not a regression.

The UI showed 461 keyword rows against the API's 431 — extra removed keywords
surfaced by "Show all keywords". Totals are unaffected.

**V1 acceptance is complete.** The report is correct, not merely well-formed.

## Conversion tracking: confirmed misconfigured

Grok's read of Goals → Conversions → Summary for the same window confirms the
inference in the previous section, and it is worse than a missing-values problem.

**All 19 conversion actions are Primary** — every one counts toward
`Conversions`. Actions that fired this week: Local actions – Other engagements
(60), Calls from Smart Campaign Ads (14), Calls from ads (13), Local actions –
Directions (10), Local actions – Website visits (6), Clicks to call (3), Book
appointment / thank-you page (2).

**Values:** partial and nominal. Most actions are $1 or "Don't use a value".
Book appointment is $5. Calls from Smart Campaign Ads carries no value. None
reflects a real repair ticket. Grok's arithmetic — 13 ad calls × $1 + 2 bookings
× $5 = $23, and 13 + 2 + 14 valueless Smart calls = 29 — reproduces the reported
totals exactly. Inferred, not confirmed by Google, but it fits precisely.

**Double counting — three distinct mechanisms:**

1. `Clicks to call` (tapping the button) and `Calls from ads` (the connected call)
   are both Primary, so one caller can count twice.
2. `Calls from ads` and `Calls from Smart Campaign Ads` are both active and Primary.
3. Map directions, website visits, and "other engagements" each count as a full
   conversion, several set to count **Every time**.

So the 23% conversion rate is not a high-performing account — it is an inflated
counter. **Neither `conversions` nor `conversions_value` is currently usable as a
business outcome measure.** Until the conversion actions are restructured
(one primary action per real business outcome, real values, secondary actions
demoted), the trustworthy signals in this feed are impressions, clicks, cost, and
search-term/keyword text.

This matters for the stated commercial priority. Engine-replacement growth cannot
be measured with a counter that scores a map-direction tap the same as a booked
job, and the opportunity score in the README depends on commercial value being
real. **Fixing conversion tracking is now the highest-leverage next action on the
Ads side — higher than any keyword or negative change**, because every future
decision would otherwise be optimising against a broken target.

Restructuring conversion actions is an **account change** and therefore outside
V1's read-only scope. It needs owner approval and should go through the
decision-queue workflow in the README, not a side effect of a reporting task.

## Control-integrity note: the write freeze has expired

`ADS_WRITE_FREEZE_UNTIL` in `src/server/google-ads/client.server.ts` is
`2026-08-29T15:00:00Z`. As of this report that is **25 days past**, so
`adsWriteFreezeActive()` returns `false` and the freeze no longer blocks anything.

The only remaining guard on a live mutation is the `confirmed: true` flag a caller
must pass to `adsMutate`. `setAdsCampaignStatus` still defaults `dryRun` to
`true`, which helps, but the code-level freeze that was assumed to be holding
is gone. Anyone relying on "the freeze will stop it" is relying on a guard that
lapsed a month ago.

Decide deliberately: extend the constant, replace it with a real approval gate, or
accept that writes are now governed by process rather than code. Do not leave it
as an expired constant that reads like protection.

## Open

- **Monday cron trigger not wired** — but see the caveat below; a plain pg_cron
  trigger would discard the report.
- **Conversion-action restructuring** — needs owner approval (above).
- **Expired write freeze** — needs a deliberate decision (above).

## Why a plain pg_cron trigger is not the right Monday wiring

The documented scheduling idiom for this repo is pg_cron + pg_net posting to the
published URL (see `docs/RINGCENTRAL_HANDOFF.md`). That is correct for the three
lead-inbox endpoints, because each one *does work* as a side effect — draining
jobs, reconciling messages, renewing subscriptions. The HTTP response is
incidental.

`ads-weekly` is the opposite: it has **no side effect**. Its entire value is the
JSON it returns. V1 deliberately has no snapshot table. So a pg_cron job would
fire it on Monday, Google would be queried, and the report would be **thrown
away** — pg_net parks the response in `net._http_response` with a short TTL, which
is not a place to read a weekly business report from.

Two coherent options:

1. **Agent-pull (no new infrastructure).** The Monday agent calls the endpoint
   when it runs and uses the response directly. This is what the current
   architecture supports, and it needs nothing built. If the agent is already
   scheduled, the job is done.
2. **Cron-push plus a snapshot table (V2).** Add an `ads_weekly_snapshots` table,
   have the endpoint persist each run, and let pg_cron fire it Monday. This buys
   durable history and week-over-week comparison, which V1 cannot do at all since
   every call is live. It requires a migration through the Lovable SQL editor.

Option 1 unless durable history is wanted. Option 2 is the natural V2 and is
where week-over-week trend analysis would come from.
