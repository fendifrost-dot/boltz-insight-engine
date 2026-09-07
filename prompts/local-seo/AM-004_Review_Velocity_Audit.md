# AM-004 — Review Velocity Audit

**Family:** Local SEO · **Module ID:** `AM-004` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Measure review arrival rate over time against the competitor set, tracking count, velocity, recency, and rating as four separate metrics. This is a listening module; it never touches solicitation.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- Count and cadence are tracked **separately** and never collapsed into one figure.

## Inputs

- Full review history with dates for Boltz
- The same for each competitor in the set
- Current review-request process, if any (owner-stated)

## Procedure

1. Build a monthly review-count series for Boltz and each competitor across at least 12 months.
2. Report **count**, **velocity** (reviews/month), **recency** (days since last review), and **rating** as four distinct metrics. Conflating them is the standard error in this analysis.
3. Compute the gap to the competitor set on each metric separately, and identify which one Boltz is actually behind on. It is frequently not the assumed one.
4. Assess the recency distribution — a high count with nothing recent reads very differently to a customer than a lower count that is current.
5. Record whether any review-request process exists today, and whether it is consistent or ad hoc.
6. Where a gap is real, describe it as a business-development finding, not as a keyword opportunity.

## Guards

- **Hard stop:** never propose scripting, incentivizing, or steering customers toward predetermined wording. This is excluded on principle and is named explicitly in `FROZEN_CHANGES`.
- Review gating — soliciting only satisfied customers — is excluded on the same basis.
- `SC-05` — do not assert velocity outweighs count. Report both and let the data speak.
- Rating average is lagging and heavily anchored; a fractional move needs large volume. Do not propose interventions targeting it directly.
- Competitor review counts can include merged or multi-location entities. Verify before comparing.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `METRIC (count / velocity / recency / rating — separately)`
- `BOLTZ VALUE`
- `COMPETITOR MEDIAN`
- `GAP`
- `RECENCY DISTRIBUTION`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Monthly count, velocity, recency, and rating — tracked as a standing monitor regardless of intervention.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-004`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
