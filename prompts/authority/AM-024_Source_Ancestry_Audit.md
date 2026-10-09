# AM-024 — Source Ancestry Audit

**Family:** Authority · **Module ID:** `AM-024` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Trace syndicated and derivative sources back to their original, so that apparent breadth is never mistaken for independent corroboration. This module prevents the most common authority self-deception in the system.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- Run this before any authority claim appears in any report. AM-027 cannot run without its output.

## Inputs

- All known sources mentioning Boltz — from AM-018, AM-023, AM-026, and manual search
- Publication dates and bylines where available
- The Provenance Ledger

## Procedure

1. Compile every known source mentioning Boltz into one list.
2. For each, retrieve the publication date and the substance of what it says.
3. Cluster sources by content: near-identical wording, identical facts in identical order, or shared distinctive phrasing indicates a shared origin.
4. For each cluster, identify the **earliest** source and mark it the information origin. Everything else in the cluster is a derivative linked to it.
5. Classify each source using the `ProvenanceRecord` flags: `firstParty`, `independent`, `syndicated`, `derivative`, `originalSource`, `businessControlled`.
6. Count distinct information origins. **This number, not the raw source count, is Boltz's real corroboration base.** Report both, leading with origins.
7. Flag clusters where a single origin produced very wide apparent coverage — high fragility, since a correction or removal at the origin propagates everywhere.
8. Check specifically for **C&J Auto Rebuilders** ancestry. A 40-year predecessor means some records may trace to a predecessor-name origin, which affects both entity continuity and how corroboration should be counted.
9. Write each finding to the Provenance Ledger with its origin linkage.

## Guards

- **Raw source count is not authority.** Never report it without the collapsed origin count beside it.
- Earliest publication date is strong but not conclusive evidence of origin — dates can be backfilled or missing. Mark unknown ancestry rather than guessing, and do not count it as independent.
- A single item distributed to many outlets is one origin regardless of how many URLs it produces.
- First-party sources — boltzautogarage.com, the GBP, owned profiles — are **never** independent corroboration. Count them separately.
- AI-generated text is never a source supporting a fact. Recording it as one is circular sourcing.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `SOURCE URL`
- `PUBLICATION DATE`
- `CLUSTER`
- `INFORMATION ORIGIN`
- `RELATIONSHIP (original / derivative / syndicated / unknown)`
- `INDEPENDENT?`
- `FIRST-PARTY?`
- `C&J ANCESTRY?`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Distinct independent information origin count, quarterly. This is the headline authority metric.

## Handoff

One Decision Queue row per finding — `category` = `Authority`, module `AM-024`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
