# AM-022 — Service Association Tracking

**Family:** GEO / AI · **Module ID:** `AM-022` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Track whether AI systems associate Boltz with engine replacement specifically, rather than with generic auto repair. Visibility without the engine association is retrieval for the wrong jobs.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- AM-017 panel transcripts, particularly the `serviceAssociation` and `engineAssociation` fields
- Open-ended association prompts: describe this shop, what is it known for, who does engine work in this area
- Context Lock service lines and commercial priorities

## Procedure

1. Record the target associations: engine replacement first, then mechanical repair, collision/body, paint, and the South Side Chicago geography.
2. Run open-ended association prompts on each platform in clean sessions.
3. Extract every service attribute the platform associates with Boltz, verbatim, and tag each as target-present, target-absent, or unintended.
4. **Track engine association as the headline metric.** A platform that knows Boltz exists but describes it only as general auto repair is a specific, reportable failure against commercial priority #1.
5. Check whether Boltz surfaces at all on engine-specific prompts (`blown engine`, `engine replacement cost`, `repair vs replace engine`) versus only on generic `mechanic near me` prompts. The difference is the whole point of this module.
6. For each absent target association, check AM-018 for whether any retrieved source states it. An association absent from every source cannot be expected in an answer — which converts a GEO problem into a source problem.
7. Track the collision/body/paint associations too; the Context Lock is explicit that secondary lines must not be starved.
8. Report as a per-association time series; associations move independently.

## Guards

- Associations reflect source content. If no source states it, the fix is upstream, not prompt-side.
- **Never propose stating an association that is not true.** Aspirational association is fabrication.
- Distinguish absent association from absent entity — a shop never mentioned at all is an AM-017/AM-018 problem, not an association problem.
- Open-ended prompts vary more than structured ones. Sample more, not less.
- Do not optimize away the secondary service lines in pursuit of engine association.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `TARGET ASSOCIATION`
- `PRESENT? (true / false / null)`
- `PLATFORM / DATE`
- `VERBATIM ATTRIBUTION`
- `ENGINE ASSOCIATION (headline)`
- `UNINTENDED ASSOCIATIONS`
- `SOURCE STATES IT? (from AM-018)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Monthly per-association presence rate per platform, with engine association reported as the headline series.

## Handoff

One Decision Queue row per finding — `category` = `GEO / AI`, module `AM-022`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
