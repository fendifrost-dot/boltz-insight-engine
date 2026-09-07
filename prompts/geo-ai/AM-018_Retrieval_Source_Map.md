# AM-018 — Retrieval Source Map

**Family:** GEO / AI · **Module ID:** `AM-018` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Capture which URLs each platform retrieved before answering, for Boltz and for competitors. This converts GEO from guesswork into a targetable list — you cannot influence retrieval without knowing what is being retrieved.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- This module directly addresses the first open question in `UNRESOLVED_QUESTIONS`: which retrieval sources actually feed AI direct mentions of Boltz.

## Inputs

- AM-017 run transcripts with full citation lists
- Source type taxonomy from `ProvenanceRecord` in `src/data/types.ts`
- Competitor dossiers

## Procedure

1. Extract every cited source across all panel responses and platforms into one table: URL, domain, which prompt, which platform, which entity it supported.
2. Classify each by `SourceType`: directory, review, editorial, database, UGC, AI synthesis, first-party, social, other.
3. **Collapse derivatives into information origins.** Five domains republishing one item are one origin. Report raw citations and distinct origins, and lead with origins.
4. Identify sources cited for competitors but never for Boltz. These are the concrete retrieval targets and the main output of this module.
5. Identify sources Boltz appears on that are never cited — presence without retrieval value, which prevents wasted effort.
6. Rank targets by citation frequency across platforms, independence, and whether inclusion is achievable legitimately.
7. Report **per platform**, never pooled. Platforms differ sharply in whether they favor directories, review sites, or first-party sources, and the difference is the actionable part.
8. Write each source into the Provenance Ledger with its origin linkage.

## Guards

- Raw citation counts overstate diversity. Collapse to origins first — this is the core discipline of the module.
- A source being cited does not mean inclusion causes citation. That is HYPOTHESIS (`SC-06`).
- `FROZEN_CHANGES` prohibits contacting directories and creating accounts or citations. This module **maps**; it does not acquire.
- Citations are volatile between runs. Aggregate across samples before drawing conclusions.
- Some platforms cite sources they did not use and use sources they do not cite. Treat citation lists as evidence, not ground truth.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `SOURCE URL / DOMAIN`
- `SOURCE TYPE`
- `INFORMATION ORIGIN`
- `CITED FOR (Boltz / competitor / both)`
- `PLATFORMS CITING IT`
- `CITATION FREQUENCY`
- `BOLTZ PRESENT ON IT?`
- `ACHIEVABLE LEGITIMATELY?`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Distinct-origin citation count for Boltz, and the count of competitor-cited origins where Boltz is absent, monthly from the panel runs.

## Handoff

One Decision Queue row per finding — `category` = `GEO / AI`, module `AM-018`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
