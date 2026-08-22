# AM-002 — GBP Attributes Audit

**Family:** Local SEO · **Module ID:** `AM-002` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Inventory which GBP attributes are available for Boltz's categories, which are set, which are unset, and which unset ones are both true and useful to a customer. Attributes are among the lowest-risk and most under-completed local surfaces.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Full attribute list available for the current category set
- Currently set attributes
- Owner confirmation of what is actually true — accessibility, payment methods, appointment policy, amenities
- Competitor attribute visibility where exposed

## Procedure

1. Enumerate every attribute available for the current categories; record each as set, unset, or explicitly negative.
2. For each unset attribute, mark `true` / `false` / `null` from owner confirmation. Never guess — `null` is the correct value for unconfirmed.
3. Flag any attribute set but **not actually true**. This is a correctness finding and outranks every optimization finding in this module.
4. Identify unset-but-true attributes that appear as consumer filters or in profile UI — the highest-value additions.
5. Note attributes that could plausibly affect filtered-search qualification, labelling the effect HYPOTHESIS unless a mechanism is documented.
6. Group findings: correctness fixes, high-relevance completions, low-relevance completions.

## Guards

- Attribute availability is category-dependent. Re-run after any category change — the available set will differ.
- An attribute set incorrectly is worse than one left unset. Correctness first.
- Do not claim attribute completeness is a ranking factor. Its defensible value is filtered-search qualification and customer clarity — say that, and nothing stronger.
- Owner confirmation is required for anything a customer could rely on when arriving: accessibility, payment, appointment policy.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `ATTRIBUTE`
- `AVAILABLE FOR CURRENT CATEGORIES?`
- `CURRENT STATE (set / unset / set-incorrectly)`
- `TRUE? (OWNER-CONFIRMED / null)`
- `CONSUMER-FILTER RELEVANT?`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Attribute completeness percentage and any filtered-search visibility proxy, 28 days after an approved batch.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-002`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
