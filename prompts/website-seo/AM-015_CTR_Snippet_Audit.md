# AM-015 — CTR / Snippet Audit

**Family:** Website SEO · **Module ID:** `AM-015` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Find pages earning impressions but not clicks, and diagnose whether the cause is the snippet, the SERP environment, or an intent mismatch. Only the first is fixable by editing the page.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- GSC page and query CTR data with position
- Current titles and meta descriptions from AM-010
- Live SERP screenshots for the affected queries

## Procedure

1. Identify pages and queries where CTR is materially below what their average position would predict. State the expectation basis rather than citing an unnamed industry curve.
2. **Look at the live SERP for each case before diagnosing.** Low CTR at position 3 beneath an AI overview, a large ad block, or a rich-result cluster is an environment effect, not a snippet defect — and no title rewrite fixes it.
3. For genuine snippet problems, assess the title: is the primary intent term present, is it truncated, is it duplicated across pages, does it say what the page is?
4. Assess the meta description: present, unique, accurate, and does it give a reason to click? Note that engines frequently rewrite it — do not overstate control.
5. Check for intent mismatch, where the page ranks but does not match what the searcher wants. That routes to AM-012 or AM-013, not to a snippet rewrite.
6. Check whether eligible rich results are being earned. A missing eligible rich result is a snippet finding.
7. Prioritize by **clicks at stake**, not CTR delta. A large percentage gap on 40 impressions is not worth an hour.

## Guards

- Never diagnose CTR without looking at the actual SERP. This is the most common error in CTR work.
- Meta descriptions are advisory. Do not promise CTR gains from a rewrite.
- Averaged position hides variance — a page averaging position 8 may alternate between 3 and 15.
- Never write titles that misdescribe the page. Short-term CTR at the cost of trust is a bad trade for a business built on a 40-year local reputation.
- Seasonality shifts automotive CTR independently of anything you do. Use a long enough window.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `PAGE / QUERY`
- `IMPRESSIONS / CTR / POSITION`
- `DIAGNOSIS (snippet / SERP environment / intent mismatch)`
- `SERP FEATURES PRESENT (observed, dated)`
- `CLICKS AT STAKE (estimate + basis)`
- `PROPOSED TITLE OR DESCRIPTION`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

CTR at held-constant position for the named pairs, at 28 and 56 days. If position moved materially the read is confounded — say so rather than claiming the win.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-015`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
