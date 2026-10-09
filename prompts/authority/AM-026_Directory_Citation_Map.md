# AM-026 — Directory/Citation Map

**Family:** Authority · **Module ID:** `AM-026` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Map directory presence and control status across automotive and local directories, recording accuracy and — critically — whether each directory is actually retrieved by AI systems, so effort goes to directories that matter rather than to volume.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Automotive and local directory list relevant to a Chicago repair shop
- Current presence, control status, and listing accuracy
- AM-018 retrieval data
- Canonical NAP from the Context Lock

## Procedure

1. Build the directory list relevant to an independent automotive repair business in Chicago: general local directories, automotive-specific directories, review platforms, mapping services, and data aggregators.
2. Record current presence on each: listed / not listed / listed incorrectly / duplicate listings — and whether Boltz controls the listing.
3. Verify each listing against the canonical NAP. **Accuracy outranks presence** — an incorrect listing actively propagates errors into AI answers and Map results.
4. Cross-reference AM-018: mark which directories are actually cited by AI platforms, and split the list into retrieved and not-retrieved.
5. Identify which directories feed others. Upstream data aggregators propagate to many downstream listings, so an upstream error is worth many downstream errors — this is the single most leveraged finding available here.
6. Check for legacy **C&J Auto Rebuilders** listings and duplicate records from the name transition.
7. Prioritize: (1) incorrect listings on retrieved directories, (2) incorrect listings on upstream feeders, (3) missing listings on retrieved directories, (4) everything else, which is usually not worth doing.
8. Flag low-quality or spam directories and exclude them explicitly.

## Guards

- `SC-07` — listing count is not a proven ranking lever. Consistency and accuracy are the defensible objectives.
- **`FROZEN_CHANGES` prohibits contacting directories and creating citations or accounts.** This module maps and prioritizes; it does not submit, claim, or correct. Corrections are a separate owner-approved action.
- Do not propose submitting to directories that exist only to sell listings.
- An incorrect listing on a retrieved directory is more urgent than a missing listing on one nobody retrieves.
- Duplicate listings are typically harder to remove than to create. Flag them early.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `DIRECTORY`
- `PRESENT? (listed / not / incorrect / duplicate)`
- `CONTROLLED BY BOLTZ?`
- `ACCURACY VS CANONICAL NAP`
- `RETRIEVED BY AI? (from AM-018)`
- `FEEDS OTHER DIRECTORIES?`
- `LEGACY C&J RECORD?`
- `PRIORITY TIER (1-4)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Count of accurate listings on retrieved directories and count of known-incorrect listings outstanding — quarterly, with a 60-day recheck after any approved corrections, since aggregator propagation is slow.

## Handoff

One Decision Queue row per finding — `category` = `Authority`, module `AM-026`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
