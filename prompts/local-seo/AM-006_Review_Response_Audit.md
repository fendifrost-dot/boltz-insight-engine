# AM-006 — Review Response Audit

**Family:** Local SEO · **Module ID:** `AM-006` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Measure response coverage, latency, and quality — with quality defined as usefulness to a prospective customer reading the thread later, not keyword density.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- All reviews with response status and response timestamps
- Response text
- Who currently owns responding, and the process (owner-stated)

## Procedure

1. Compute response rate overall and **split by rating band** — unanswered negative reviews are a materially different finding from unanswered positive ones.
2. Compute median response latency, also split by rating band.
3. Assess each negative-review response for whether it addresses the specific complaint and would reassure a prospect reading it months later. This is the highest-value part of the module.
4. Flag responses templated to the point of visible repetition; a reader scanning ten responses notices immediately.
5. Compare response rate and latency to the competitor set.
6. Record whether responses contain service terms, and classify any ranking effect as HYPOTHESIS per `SC-02`. Report it as a neutral observation, never as a recommendation.

## Guards

- `SC-02` — keyword-bearing responses are unproven for ranking. Never recommend writing responses _for_ keywords. The defensible reason to respond well is that prospects read them.
- Never propose a response that disputes facts publicly, discloses customer information, or reads as defensive. The reputational downside exceeds any search upside.
- Do not recommend responding at volume with generated text; visible templating is worse than silence.
- Latency matters most on negative reviews — do not average it away.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `RESPONSE RATE (overall / by rating band)`
- `MEDIAN LATENCY (overall / by rating band)`
- `UNANSWERED NEGATIVE COUNT`
- `RESPONSE QUALITY ISSUE (specific)`
- `COMPETITOR COMPARISON`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Response rate and median latency by rating band, monthly. Any ranking claim requires the `SC-02` experiment, not this module.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-006`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
