# AM-003 — GBP Services Audit

**Family:** Local SEO · **Module ID:** `AM-003` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Audit the GBP services list against Boltz's actual service lines and against how customers phrase engine demand — with explicit attention to whether engine replacement is listed, correctly named, and described.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Current GBP services list with descriptions
- Confirmed service lines from the Context Lock
- Predefined versus custom service options available for the categories
- Customer phrasing evidence from AM-005 and the Query Universe

## Procedure

1. Record every listed service, whether predefined or custom, and whether it carries a description.
2. Diff against the confirmed service lines. Services performed but unlisted are gaps; services listed but not performed are correctness findings and take priority.
3. Verify **engine replacement** is listed, phrased the way customers search, and described. Commercial priority #1 being absent or buried is the headline finding available here.
4. Check that collision, body, and paint lines are represented — the Context Lock is explicit that secondary lines must not be starved.
5. Identify predefined services available for the current categories that map to real Boltz services and are unlisted.
6. For custom services, compare naming against observed customer phrasing rather than trade terminology.
7. Flag services with empty descriptions — consumer-facing surface area that is nearly always left blank.

## Guards

- Never list a service Boltz does not perform.
- Available predefined services depend on categories; re-run after any category change.
- Do not stuff service names with modifiers. The name should be what a customer would say.
- The defensible benefit is clarity and qualification, not rank. Do not overstate the mechanism.
- Do not let engine focus starve the collision/body/paint lines — that contradicts an explicit owner priority.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `SERVICE`
- `LISTED?`
- `TYPE (predefined / custom)`
- `DESCRIPTION PRESENT?`
- `PERFORMED? (OWNER-CONFIRMED)`
- `CUSTOMER PHRASING MATCH`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Service-list completeness against the confirmed service lines, plus service-query visibility for engine replacement, 28 days after an approved batch.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-003`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
