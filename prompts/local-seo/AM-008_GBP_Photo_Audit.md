# AM-008 — GBP Photo Audit

**Family:** Local SEO · **Module ID:** `AM-008` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Inventory photo coverage by service line, assess quality against what an engine-replacement prospect needs to see, and resolve mechanically whether EXIF geotags survive upload before anyone spends effort on them.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Photo inventory by category: exterior, interior, team, work performed, equipment
- Upload dates and owner-versus-customer attribution
- Photo view data if available
- One test image with known EXIF GPS, for the stripping check

## Procedure

1. Inventory photos by category and count, and record the most recent owner upload date.
2. Identify coverage gaps against what an engine-replacement prospect wants to see: evidence of engine work, the bay, the equipment, the facility — not stock imagery.
3. Assess quality: resolution, lighting, and whether images are genuine. Stock imagery on a local profile is a credibility finding.
4. Compare owner-photo to customer-photo ratio and the recency of each.
5. **Resolve `SC-03` mechanically first:** upload one test image with known EXIF GPS, re-download it from the profile, inspect whether EXIF survived. If stripped, geotagging is mechanically dead — record REJECTED with the evidence and close the question permanently. This costs minutes.
6. Record photo view counts where available as the only directly measurable photo outcome.

## Guards

- `SC-03` has a weak prior. Do the stripping test before any geotagging work is considered.
- Never propose stock or generated imagery presented as the real facility or real work.
- Photo view counts are a visibility proxy, not a ranking metric.
- Customer photos cannot be controlled; do not build recommendations that depend on them.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `CATEGORY`
- `COUNT`
- `MOST RECENT UPLOAD`
- `COVERAGE GAP (engine-specific called out)`
- `EXIF SURVIVES UPLOAD? (CONFIRMED yes / CONFIRMED no / untested)`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Photo count by category, most-recent-upload date, and photo views, monthly. The EXIF question is measured once and closed.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-008`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
