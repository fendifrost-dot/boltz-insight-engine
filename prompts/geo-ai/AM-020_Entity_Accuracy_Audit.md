# AM-020 — Entity Accuracy Audit

**Family:** GEO / AI · **Module ID:** `AM-020` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Check the NAP, hours, and service claims stated by AI systems against the Context Lock. Accuracy is upstream of visibility: being described wrongly is worse than not being described, because a customer acts on the wrong information.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- The Context Lock is ground truth for this module. A fact not in the Context Lock is scored `unverifiable`, never scored as wrong.

## Inputs

- AM-017 panel transcripts
- Context Lock: name, address, phone, website, hours, last-appointment time, service lines, history
- Known confusable entities — other Chicago shops, the C&J predecessor name

## Procedure

1. For every Boltz claim in every panel response, extract the claim and compare it to the Context Lock.
2. Classify each: accurate / partially accurate / inaccurate, matching the `factualAccuracy` field, and note whether it is a NAP fact, an hours fact, a service fact, or a history claim.
3. **Check hours especially carefully.** Monday-Saturday 9 AM-5 PM with a last regular appointment around 4 PM is a fact a customer acts on physically — a wrong closing time sends someone to a closed shop, which is a real-world harm and not merely an SEO defect.
4. Check the phone number and address digit by digit. Transposed digits are common in syndicated listings and propagate widely.
5. Check service claims: does the platform know Boltz does engine replacement, collision, body, and paint? Missing engine association routes to AM-022.
6. Flag conflation with other entities, including any predecessor-name confusion with C&J Auto Rebuilders.
7. Catalogue each specific inaccuracy with exact wording, platform, and date. Specific inaccuracies are actionable; an accuracy percentage alone is not.
8. For each inaccuracy, trace the plausible source via AM-018. Correcting the origin is the only durable fix.
9. Flag any inaccuracy with real-world cost: wrong hours, wrong phone, wrong address, wrong services.

## Guards

- Never fill a Context Lock gap from an AI answer to score against it. That is circular and would launder a hallucination into ground truth — the highest-severity error available in this system.
- A confidently stated hallucination is evidence about the model, not about Boltz.
- Do not propose publishing a rebuttal page. Correct the source data where it exists.
- Do not treat a platform declining to answer as an inaccuracy. That is `null`, not wrong.
- Never invent history to correct a history claim — the C&J legacy is the record and nothing may be added to it.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `CLAIM AS STATED (verbatim)`
- `PLATFORM / DATE`
- `GROUND TRUTH (Context Lock)`
- `VERDICT (accurate / partially accurate / inaccurate / unverifiable)`
- `FACT TYPE (NAP / hours / service / history)`
- `PLAUSIBLE SOURCE OF ERROR`
- `REAL-WORLD COST`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Per-platform accuracy rate, monthly, with the unverifiable count reported alongside rather than folded in, and outstanding real-world-cost inaccuracies tracked to zero.

## Handoff

One Decision Queue row per finding — `category` = `GEO / AI`, module `AM-020`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
