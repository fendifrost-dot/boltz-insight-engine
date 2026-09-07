# AM-025 — Editorial Node Map

**Family:** Authority · **Module ID:** `AM-025` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Identify the genuinely editorial local sources covering automotive services and the South Side Chicago business community — the nodes whose coverage is independently produced and actually retrieved by AI systems.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- AM-018 retrieval source map — which outlets are actually cited
- AM-024 ancestry data — which outlets produce originals versus republish
- Local Chicago and South Side publications, community organizations, trade coverage
- Competitor coverage history from the dossiers

## Procedure

1. Identify outlets covering local business, community, and automotive topics in the relevant geography, recording the discovery method for each.
2. For each, determine from AM-024 whether it produces original reporting or primarily republishes. Originators are worth far more.
3. Cross-reference AM-018: which outlets do AI platforms actually cite? An outlet with local prestige but no retrieval presence is a different kind of target than one cited constantly.
4. Identify individual writers or editors who cover local business or the South Side specifically. Coverage is granted by people, not by domains.
5. Record what each outlet has covered for competitors and what angle it took — this reveals what the outlet finds newsworthy.
6. Assess fit honestly: does Boltz have anything genuinely newsworthy for this outlet? A 40-year business with a documented predecessor lineage and an expanding mechanical capacity is a real local-business story — but only if the outlet covers that kind of story.
7. Rank nodes by originality, retrieval presence, local relevance, and realistic access.
8. Mark pay-to-play outlets as excluded rather than listing them as opportunities.

## Guards

- **Never propose paid placement presented as editorial**, or any arrangement where payment is undisclosed. Hard stop.
- `FROZEN_CHANGES` prohibits contacting anyone. This module maps and qualifies; outreach is a separate owner-approved decision.
- Prestige and retrieval presence are different axes. Map both; do not assume they correlate.
- A target list without a genuine story is not a plan. Fit is a required field.
- Never misrepresent Boltz's significance or fabricate a hook. The recorded history is the C&J lineage from approximately 1982 — accurate and genuinely interesting, and it needs no embellishment.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `OUTLET / WRITER`
- `ORIGINATOR OR REPUBLISHER`
- `AI RETRIEVAL PRESENCE (from AM-018)`
- `COVERS COMPETITORS? (which, what angle)`
- `LOCAL RELEVANCE`
- `GENUINE HOOK AVAILABLE?`
- `PAY-TO-PLAY? (excluded if yes)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Count of independent editorial originations, quarterly, plus whether newly gained nodes appear in the AM-018 citation map.

## Handoff

One Decision Queue row per finding — `category` = `Authority`, module `AM-025`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
