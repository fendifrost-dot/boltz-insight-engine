# AM-011 — GSC Opportunity Mining

**Family:** Website SEO · **Module ID:** `AM-011` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Mine Search Console for queries and pages where small movement yields disproportionate return — striking-distance positions, high-impression low-CTR pages, and queries ranking on the wrong page — weighted by engine relevance rather than raw volume.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- **GSC access availability is an open question** in `UNRESOLVED_QUESTIONS`. Confirm access and the history window before this module can run; if unavailable, record that as the finding and stop.

## Inputs

- GSC performance export: query x page x impressions x clicks x CTR x position, longest window available
- URL inventory from AM-010
- Query Universe clusters and their `CLUSTER_WEIGHT` values

## Procedure

1. Export query-level and page-level data for the longest available window, and record the window explicitly — comparisons across different windows are meaningless.
2. Segment branded from non-branded before any analysis. Branded performance masks everything and inflates every aggregate.
3. Find striking-distance queries (roughly positions 5-20) with meaningful impressions, and rank them by **cluster weight**, not impression count. Engine clusters carry 0.8-1.0; `mechanic near me` carries 0.55; `trust/reputation` carries 0.35.
4. Find high-impression, low-CTR pages where position does not explain the CTR. These route to AM-015.
5. Find cannibalization: one query where the ranking URL fluctuates, or where the ranking page is not the best page. Often fixable without new content.
6. Find queries with impressions but effectively zero clicks over a long window — usually intent mismatch rather than a ranking problem.
7. **Isolate the engine clusters as their own segment** and report them regardless of their share of the aggregate.
8. Cross-reference top opportunities against AM-010 — confirm the target page is technically sound before recommending content work.

## Guards

- GSC position is an average across many contexts. It is not a rank; never report it as one.
- Impressions inflate for queries the site barely appears on. State the impression floor you filtered at.
- Segment branded versus non-branded or every conclusion is wrong.
- GSC data is sampled and truncated in the long tail. Absence in GSC is not absence of demand.
- Do not rank opportunities by volume. `CLUSTER_WEIGHT` exists precisely to prevent that.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `QUERY OR PAGE`
- `CURRENT POSITION / IMPRESSIONS / CTR`
- `OPPORTUNITY TYPE (striking-distance / low-CTR / cannibalization / intent-mismatch)`
- `QUERY CLUSTER + CLUSTER WEIGHT`
- `TARGET PAGE (existing or needed)`
- `DATA WINDOW`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Position, impressions, clicks, and CTR for the named queries at 28 and 56 days, using the same window length as the baseline.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-011`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
