# AM-005 — Review Language / Sentiment Audit

**Family:** Local SEO · **Module ID:** `AM-005` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Theme customer review text to learn what customers actually say, and specifically whether engine work appears in unprompted customer language at all. A large gap between revenue mix and review language mix is a real, actionable finding.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Review text for the trailing 12 months
- Service mix or revenue mix from the owner, where available, for comparison
- Query Universe clusters for vocabulary comparison

## Procedure

1. Tag each review for the service it describes: mechanical, engine, collision/body, paint, or general.
2. Extract the service terms customers use unprompted, and compare them to the Query Universe cluster vocabulary.
3. Compute the share of reviews mentioning engine work. Compare against the engine share of actual business — a large divergence means the highest-value work is invisible on the profile.
4. Identify recurring positive themes: what customers consistently credit Boltz for.
5. Identify recurring complaint themes. Operational findings are legitimate output here and should be reported even though they are not SEO.
6. Note vocabulary customers use that differs from how Boltz describes its own services — that mismatch feeds AM-003 and AM-013.

## Guards

- **Never propose influencing review wording.** Observation only. This is named in `FROZEN_CHANGES` and is a hard stop.
- Reviews are self-selected and skew to extremes; treat themes as OBSERVED, never CONFIRMED, about overall service quality.
- Do not infer engine demand from engine review share alone — customers describe the outcome, not the invoice.
- Report operational themes plainly; suppressing them because they are not SEO wastes the most useful signal in the dataset.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `THEME`
- `REVIEW COUNT / SHARE`
- `SERVICE LINE`
- `UNPROMPTED CUSTOMER VOCABULARY`
- `ENGINE MENTION SHARE vs BUSINESS MIX`
- `OPERATIONAL THEME (if any)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Engine mention share and theme distribution, monthly, alongside the AM-004 series.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-005`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
