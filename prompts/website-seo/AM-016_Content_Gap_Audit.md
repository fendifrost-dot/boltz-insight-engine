# AM-016 — Content Gap Audit

**Family:** Website SEO · **Module ID:** `AM-016` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Identify topical coverage gaps relative to what engine buyers need to know and what competitors cover — with a hard filter for engine value and a hard filter against content that exists only to exist.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Site content inventory from AM-010
- Competitor content inventories from the dossiers
- Query gaps from AM-013
- Real customer questions from reviews (AM-005), phone enquiries, and the service counter

## Procedure

1. Inventory existing content by topic and buyer stage, not by URL count.
2. Build the buyer-question list from real sources — reviews, phone enquiries, what customers ask at the counter. Real questions beat inferred topics every time.
3. Map competitor topical coverage from the dossiers, recording what they cover and whether it visibly performs.
4. Diff, then apply two filters in order: (a) does answering this help someone who might buy an engine replacement or another Boltz service? (b) does it plausibly influence that decision? Failing both is REJECTED.
5. Weight surviving gaps by `CLUSTER_WEIGHT`. Engine cost, repair-versus-replace, and rebuilt-versus-remanufactured comparisons are the highest-value explanatory content available to this business.
6. Decide whether the answer belongs on an existing money page (usually better) or needs its own page. Strengthening an engine page beats a new thin page in most cases.
7. For each proposed piece, state the query cluster, the buyer stage, and how it will be measured.
8. Check whether a non-content fix serves better — clearer service description, an FAQ block on the engine page, a photo of actual work.

## Guards

- Content volume is not a goal. Every proposed piece needs a named cluster and a measurement plan or it is REJECTED.
- Competitor coverage is not proof of value — their blog may be a cost center. `SC-04` reasoning applies here too.
- Prefer strengthening an existing engine page over creating a new thin page.
- Do not propose generated content at volume. It fails the sufficiency test and creates a durable liability for a business whose value is local trust.
- Never invent history or credentials to fill a trust-content gap. The recorded legacy is C&J Auto Rebuilders, South Side, approximately 1982 — nothing beyond that.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `TOPIC / QUESTION`
- `EVIDENCE IT IS ASKED (source)`
- `BUYER STAGE`
- `CLUSTER + WEIGHT`
- `COMMERCIAL FILTER RESULT (pass / fail)`
- `PLACEMENT (existing page / new page / non-content fix)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

For each shipped piece: impressions and clicks for its named cluster, plus assisted engine enquiries where measurable, at 56 and 90 days.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-016`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
