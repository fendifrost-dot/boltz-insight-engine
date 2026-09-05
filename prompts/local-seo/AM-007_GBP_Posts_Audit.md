# AM-007 — GBP Posts Audit

**Family:** Local SEO · **Module ID:** `AM-007` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Log current and competitor posting cadence as an observational baseline, and hold the line that posting frequency is an unproven ranking lever. Output is a baseline and, optionally, an experiment design — never a posting schedule justified by ranking claims.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Post history: dates, types, content, calls to action
- Competitor post history where visible
- Any available post view or interaction data

## Procedure

1. Record Boltz's post history: cadence, types, and whether posts carry a working call to action.
2. Record competitor cadence where visible, noting that post visibility decays — historical competitor data is systematically incomplete and must be reported as such.
3. Assess whether existing posts communicate anything a prospect needs (capacity, turnaround, engine service availability, financing) or are filler.
4. Record any interaction data as the only directly measurable outcome of posting.
5. If posting is to be pursued, design it as a registered experiment under `SC-01`: fixed cadence, **all other GBP fields frozen**, a pre-period baseline, and a declared failure criterion.
6. Report the cost honestly — recurring human effort against an unproven ranking return and a modest direct-visibility return.

## Guards

- `SC-01` — posting frequency causing ranking improvement is a HYPOTHESIS. Never present a cadence as a ranking recommendation.
- Posts expire; competitor history is incomplete by construction. Do not present it as reliably measured.
- Do not recommend high-volume posting to manufacture activity signals.
- If posting proceeds without being a registered experiment, it will produce another year of unfalsifiable belief. Insist on the design.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `CURRENT CADENCE (posts/month, trailing 6mo)`
- `POST TYPES USED`
- `CTA PRESENT / FUNCTIONAL`
- `COMPETITOR CADENCE (with visibility caveat)`
- `EXPERIMENT DESIGN PROPOSED?`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Post interaction counts. Non-branded Map Pack impressions only under a registered `SC-01` experiment with all other fields frozen.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-007`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
