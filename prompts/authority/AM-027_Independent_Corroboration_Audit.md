# AM-027 — Independent Corroboration Audit

**Family:** Authority · **Module ID:** `AM-027` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Count only non-duplicated, non-syndicated corroboration of Boltz's key facts, producing the durable measure of how well the business is independently established across the web. Built on origins, never on URL counts.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- Requires AM-024 ancestry data. Without collapsed origins this count is meaningless and must not be produced.

## Inputs

- AM-024 ancestry clusters and origin identifiers
- The key fact set from the Context Lock
- The Provenance Ledger

## Procedure

1. Define the key fact set from the Context Lock: business name, address, phone, hours, engine replacement service, collision/body/paint lines, and the C&J lineage.
2. For each key fact, list every source stating it.
3. Collapse those sources to distinct information origins using AM-024.
4. Exclude first-party sources from the corroboration count, but record them separately — first-party sources matter for accuracy, just not for independence.
5. Score each fact by independent origin count, and report the **raw origin count** alongside any band. A band alone hides the difference between one origin and four.
6. Identify the weakest facts — those with no independent origin. These are the facts AI systems will get wrong or omit, and they are the actionable output.
7. Cross-reference AM-020: facts with low corroboration should correlate with observed inaccuracies. Where they do, state the mechanism as OBSERVED, not proven.
8. Give engine replacement its own reading. If the engine service line is corroborated only by first-party sources, that directly explains weak engine association in AM-022 and is the highest-value gap in the system.
9. Track the profile over time; growth in independent origins for weak facts is the durable authority objective.

## Guards

- **Never count derivatives as independent.** This is the entire point of the audit.
- Never count first-party sources toward independence — not the website, not the GBP, not owned profiles.
- The count is an internal instrument, not a public claim.
- Never attempt to raise it through manufactured coverage, created citations, or solicited mentions. That is fabricated corroboration and is prohibited by `FROZEN_CHANGES`.
- A fact with zero independent origins is `0`, not `null` — you looked and found none. The distinction matters here more than anywhere.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `KEY FACT`
- `INDEPENDENT ORIGINS (count, listed)`
- `FIRST-PARTY SOURCES (count, separate)`
- `ENGINE SERVICE CORROBORATION (called out)`
- `OBSERVED AI ACCURACY ON THIS FACT (from AM-020)`
- `WEAKEST-LINK FLAG`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Quarterly corroboration profile per key fact, tracked as independent-origin counts with the AM-020 accuracy rate alongside.

## Handoff

One Decision Queue row per finding — `category` = `Authority`, module `AM-027`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
