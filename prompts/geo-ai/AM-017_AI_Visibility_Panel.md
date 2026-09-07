# AM-017 — AI Visibility Panel

**Family:** GEO / AI · **Module ID:** `AM-017` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Run the standard query set on each platform and record one structured row per test. This is the instrument every other GEO module reads from — if the panel is not disciplined, nothing downstream is interpretable.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- The prompt panel is **versioned and frozen** once created. Adding prompts creates panel v2 and starts a new series; it does not extend the old one.
- Runs record platform, date, and whether personalization or history was active. A logged-in personalized session is not a measurement.
- Platforms are **never blended** into one score. `AiVisibilityRecord` is per-platform by design.

## Inputs

- The frozen prompt panel, or this run creates v1 from the Query Universe
- The six tracked platforms in `PLATFORMS`: ChatGPT, Gemini, Perplexity, Copilot/Bing, Google AI, Grok
- Clean sessions — no history, no personalization, consistent Chicago locale
- The Context Lock, for what a correct answer would even contain

## Procedure

1. If no panel exists, build v1 from the Query Universe: entity prompts, engine-service prompts, local prompts (`mechanic near me`, `South Side auto repair`), comparison prompts (`repair vs replace engine`), and transactional prompts. Record the rationale for each.
2. Freeze the panel with a version number and date, stored under `data/baselines/`.
3. Run every prompt on every platform in a clean session with a consistent Chicago locale — local answers are location-sensitive and an inconsistent locale silently destroys comparability.
4. Record per response: `directMention`, `recommendationRank`, `presentInRetrievedSource`, `sourceUrl`, `sourceInternalRank`, `boltzSiteCited`, `competitors`, `factualAccuracy`, `serviceAssociation`, `engineAssociation`.
5. Record the **full response verbatim** alongside the structured row. Later modules re-analyze these transcripts, and a summary destroys them.
6. Record every cited source with its URL — the raw input to AM-018 — even when Boltz is absent.
7. Repeat each prompt at least twice per run to capture non-determinism, and record the variance. A single sample is an anecdote.
8. Store the run as a dated artifact. Never overwrite a prior run — historical data is append-only.

## Guards

- AI answers are **non-deterministic**. A single run is not a measurement. Sample repeatedly and report variance.
- Personalization and chat history contaminate results silently. Use clean sessions and say which.
- Platforms change models and retrieval without notice; a shift may be theirs, not yours. Note known platform changes alongside the run.
- Never change the panel to chase better numbers. Panel changes start a new series.
- Boltz being absent is a valid, important result. Do not re-prompt until it appears and then report that.
- Use `null` for anything not observed. `false` means observed-and-absent; the two are not the same.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `PANEL VERSION`
- `PROMPT`
- `PLATFORM`
- `RUN DATE`
- `DIRECT MENTION (true / false / null)`
- `RECOMMENDATION RANK`
- `COMPETITORS PRESENT`
- `SOURCES CITED`
- `ENGINE ASSOCIATION`
- `VARIANCE ACROSS SAMPLES`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Re-run the full frozen panel monthly. Report per-platform mention rate and variance — never a single-run number as a trend, and never a blended cross-platform score.

## Handoff

One Decision Queue row per finding — `category` = `GEO / AI`, module `AM-017`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
