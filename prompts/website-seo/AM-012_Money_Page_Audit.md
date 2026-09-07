# AM-012 — Money Page Audit

**Family:** Website SEO · **Module ID:** `AM-012` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Deep-audit the engine-replacement pages and the small set of other revenue-intent pages, against both search relevance and conversion clarity. These pages carry commercial priority #1 and are routinely audited as if they were ordinary pages.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- The money-page list, confirmed with the owner — not inferred from traffic
- Crawl data for those pages from AM-010
- GSC query data for those pages
- The pages as a prospect sees them, on mobile

## Procedure

1. Confirm the money-page list with the owner. It must include the engine-replacement page(s); collision/body and paint pages belong here too, since the Context Lock is explicit those lines must not be starved.
2. For each page, record the query intent it is built to satisfy, and whether that matches the queries it actually receives in GSC.
3. Audit the conversion path: is the primary action visible without scrolling on mobile, does it work, how many steps to complete? A broken or buried call to action outranks every SEO finding on the page.
4. Audit content sufficiency for the intent. An engine-replacement buyer needs cost drivers, timeline, warranty terms, the used/remanufactured/rebuilt distinction, financing, and process. Gaps here are usually the real ranking constraint, not keywords.
5. Check trust signals: reviews, credentials, guarantees, real photography, the 40-year C&J legacy where accurate, contact clarity.
6. Check the page's technical state from AM-010. An engine page with an indexability or render problem is a critical finding.
7. Record internal links into the page and their anchor text — feeds AM-014.
8. Check retrievability without JavaScript. These are the pages most worth citing in an AI answer, so a non-JS retriever must be able to read them.

## Guards

- Do not infer the money-page list from traffic. The highest-value page may have almost none — that is frequently the finding.
- Conversion problems outrank ranking problems here. Report them even though they are not strictly SEO.
- Content sufficiency for the intent is the standard, not word count.
- Audit on mobile first.
- Note that the payment/application experience is a **separate Lovable project**. Do not propose merging it into the public site or into this Ops project — the Context Lock keeps them distinct.
- Money pages are the most likely surfaces to be under an active experiment. Check the registry before proposing anything.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `PAGE URL`
- `INTENT IT SERVES`
- `QUERIES IT ACTUALLY RECEIVES`
- `CONVERSION PATH ISSUE`
- `CONTENT SUFFICIENCY GAP (engine-buyer specifics)`
- `TRUST SIGNALS PRESENT`
- `TECHNICAL STATE (from AM-010)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Per page: non-branded impressions, clicks, position for target queries, and the conversion event rate, at 28 and 56 days.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-012`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
