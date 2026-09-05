# AM-013 — Query Gap Audit

**Family:** Website SEO · **Module ID:** `AM-013` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Compare Query Universe coverage against existing pages to find demand Boltz is not eligible for at all — queries with real commercial intent where no page exists or no page is appropriate.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Query Universe: clusters, intent, engine relevance, current visibility
- GSC query data — what the site is already eligible for
- Competitor page inventories from the dossiers
- Customer language from AM-005

## Procedure

1. Build the list of queries the site currently receives impressions for. This defines current eligibility.
2. Diff against the Query Universe. Clusters with commercial intent and zero impressions are gaps.
3. For each gap, determine whether an existing page could plausibly serve it (a relevance fix) or no page exists (a content gap). These have very different costs and must never be merged.
4. Weight each gap by `CLUSTER_WEIGHT`. `engine replacement` (1.0), `engine replacement cost` (0.95), and `blown engine` (0.9) outrank `trust/reputation` (0.35) even at lower volume.
5. Give particular attention to `repair vs replace engine` and `used/remanufactured/rebuilt engine` — high-intent comparison clusters where a buyer is actively deciding, and where a shop that answers well earns the job.
6. Check the SERP for each high-value gap: what page type ranks? If it is dominated by national brands, marketplaces, or directories, record the realistic ceiling before recommending a page.
7. Flag gaps where Boltz cannot realistically compete. Recommending a page that cannot rank is cost with no return.

## Guards

- Do not build the gap list from keyword-tool volume alone. Volume without intent is the classic trap, and `CLUSTER_WEIGHT` exists to counter it.
- A gap is only real if Boltz actually serves that demand.
- Check SERP composition before recommending content. Some SERPs are structurally closed to a single-location shop.
- Do not propose a page per keyword variant. One page per intent.
- `South Side auto repair` and `auto repair Chicago` carry geographic intent — a national-volume automotive query with no local intent is not a Boltz opportunity.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `QUERY / CLUSTER`
- `CLUSTER WEIGHT`
- `INTENT (informational / commercial / transactional / navigational)`
- `CURRENT ELIGIBILITY (impressions or null)`
- `GAP TYPE (no page / wrong page / weak page)`
- `SERP COMPOSITION + REALISTIC CEILING`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Eligibility check — does the site now receive impressions for the named cluster? 56 days after any approved page ships; new pages need longer than 28 days to register.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-013`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
