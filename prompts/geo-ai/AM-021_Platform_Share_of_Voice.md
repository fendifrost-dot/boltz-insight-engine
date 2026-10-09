# AM-021 — Platform Share of Voice

**Family:** GEO / AI · **Module ID:** `AM-021` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Measure per-platform competitor mention share against a defined competitor set, so visibility is tracked against the field rather than in isolation. Never blended into a single cross-platform score.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- AM-017 panel transcripts
- Defined competitor set with the inclusion basis stated
- Consistent prompt categorization

## Procedure

1. Fix the competitor set and record why each competitor is included. Changing the set mid-series invalidates the trend exactly as changing the panel does.
2. For each prompt and platform, record every business mentioned, in order of appearance.
3. Compute share of voice per platform and per prompt category, reporting the denominator every time.
4. Weight by framing where useful — being recommended is not the same as being listed as an also-ran. If you weight, publish the weighting.
5. **Report per platform separately.** The data model enforces this and so should the analysis; a pooled average across platforms with different retrieval behavior is misleading.
6. Identify prompt categories where Boltz is strong and weak, and cross-reference the weak ones to AM-018 to find which sources drive them.
7. Give the engine clusters their own share-of-voice reading — commercial priority #1 deserves its own number rather than being diluted into a general average.

## Guards

- The competitor set determines the number. Publish the set alongside the number every time.
- Share of voice is not market share and does not imply revenue. Do not let it become a vanity KPI while engine jobs are the actual objective.
- Panel composition determines the result. A panel skewed to prompts Boltz wins produces a flattering, useless number.
- Non-determinism applies; report variance and sample counts.
- Never blend platforms into one score.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `PLATFORM`
- `PROMPT CATEGORY`
- `BOLTZ MENTIONS / TOTAL MENTIONS (with denominator)`
- `SHARE OF VOICE %`
- `ENGINE-CLUSTER SHARE (separately)`
- `COMPETITOR SET VERSION`
- `VARIANCE`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Monthly per-platform share of voice by prompt category, reported with the competitor set version and sample counts.

## Handoff

One Decision Queue row per finding — `category` = `GEO / AI`, module `AM-021`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
