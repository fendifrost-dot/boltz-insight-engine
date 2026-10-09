# AM-019 — Source→Mention Conversion

**Family:** GEO / AI · **Module ID:** `AM-019` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Measure the rate at which source presence converts into a direct Boltz mention. This tests the central GEO assumption rather than assuming it, and it is what stops the whole programme becoming faith-based.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- Requires at least two dated AM-018 source maps. With one, there is nothing to compare and the module cannot run.

## Inputs

- Two or more dated AM-018 source maps
- Record of where Boltz gained or lost presence between runs
- Panel results across the same runs

## Procedure

1. Build Boltz's presence set at T1: which retrieved sources did Boltz appear on?
2. Build the mention set at T1: which prompts produced `directMention` true, on which platforms?
3. Repeat for T2. Identify sources where presence changed between the two.
4. For each presence change, examine whether mention rate changed on prompts where that source is cited — and state explicitly **whether the design supports a causal claim**. Usually it does not, without a control.
5. Compute the conversion indicator: of prompts citing a source Boltz is present on, what share mention Boltz? Track it over time.
6. Identify high-citation sources where Boltz is present but still never mentioned. The presence is not converting and something else is the constraint — that is a genuinely useful finding.
7. Flag confounders: platform model updates, competitor changes, seasonality, other concurrent interventions.

## Guards

- **This is correlational by default.** Never report causation without a registered experiment with a control. The claim class is OBSERVED, not CONFIRMED.
- Platform model updates move everything at once. Check for one before attributing a shift to your work.
- Two runs is a trend of two points; three is barely a trend. Say so.
- Presence without mention is a real finding, not a failed measurement.
- Never deploy several source changes at once and attribute the result to one.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `SOURCE / ORIGIN`
- `PRESENCE AT T1 / T2`
- `MENTION RATE AT T1 / T2 (on prompts citing that source)`
- `CONVERSION INDICATOR`
- `CAUSAL CLAIM SUPPORTED? (usually no)`
- `CONFOUNDERS PRESENT`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Conversion indicator recomputed each monthly panel run, reported as a series with sample counts — never as a single figure.

## Handoff

One Decision Queue row per finding — `category` = `GEO / AI`, module `AM-019`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
