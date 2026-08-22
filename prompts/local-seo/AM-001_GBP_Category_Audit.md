# AM-001 — GBP Category Audit

**Family:** Local SEO · **Module ID:** `AM-001` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Record the live primary and secondary Google Business Profile categories, compare them against the competitor set, and identify category gaps that correspond to services Boltz genuinely performs. Produces justified candidates, never a copy list.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- A primary category change resets category association and is among the highest-risk local edits available. This module proposes; it never changes.
- The live category configuration is currently an open question in `UNRESOLVED_QUESTIONS` — establishing it is this module's first job.

## Inputs

- Live GBP primary and secondary categories, read from the profile itself rather than a third-party scrape
- Confirmed service list from the Context Lock: mechanical repair, engine replacement, collision/body, paint
- Competitor set with the inclusion basis stated (proximity, service overlap, or SERP occupancy)
- Category-query SERP samples for engine-intent terms

## Procedure

1. Record the current primary and every secondary category verbatim, with the date observed. This closes an open Context Lock question.
2. For each competitor, record primary and visible secondary categories, noting the retrieval method — secondary categories are not always fully exposed.
3. Build a category frequency table across the competitor set, keeping the primary column and the secondary column **separate**. They behave differently and pooling them hides the finding.
4. For each category Boltz does not hold, answer in writing: **does Boltz actually perform this service?** If no, it is rejected here regardless of competitor frequency.
5. For surviving candidates, judge whether the category is the best available match for a real service or merely adjacent. Prefer precision over breadth.
6. Check whether the current primary category is the best match for engine replacement — commercial priority #1. A mismatch here is the highest-impact finding this module can produce.
7. For each candidate, state the expected mechanism (which queries it could make Boltz eligible for) and the risk (which association it could dilute).

## Guards

- `SC-04` — competitor category frequency is evidence of their choice, not of effectiveness. Never recommend a category because competitors hold it.
- Never recommend a category describing a service Boltz does not perform. Hard stop — that is misrepresentation, not optimization.
- Keep primary and secondary separate in every table.
- Undated category observations are worthless; configurations change.
- One category change at a time. Simultaneous changes are unreadable and only theoretically unwindable.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `CURRENT PRIMARY CATEGORY`
- `PROPOSED CHANGE (primary / add secondary / remove secondary / none)`
- `SERVICE JUSTIFICATION (the real service this reflects)`
- `COMPETITOR FREQUENCY (n of N — primary vs secondary, separately)`
- `DILUTION RISK`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Category-query Map Pack visibility and GBP discovery-search count, at 28 and 56 days after any approved change, against the pre-change baseline.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-001`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
