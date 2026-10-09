# AM-009 — Citation Consistency Audit

**Family:** Local SEO · **Module ID:** `AM-009` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Find every place Boltz's name, address, and phone appear across the web and identify inconsistencies against the canonical record. Consistency is the defensible objective; raw citation count is not, and the two are routinely confused.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- The canonical NAP is in the Context Lock: Boltz Automotive Inc., 707 W. 119th St., Chicago, IL 60628, (708) 575-4555, boltzautogarage.com, Monday-Saturday 9 AM-5 PM. That record is the reference for every comparison.

## Inputs

- Canonical NAP from the Context Lock
- Directory and aggregator listings
- Search results for the business name, the phone number, and the address — searched independently
- Any prior citation audit

## Procedure

1. Confirm the canonical NAP from the Context Lock before comparing anything.
2. Search each NAP element **independently**. Searching the phone number and the address separately surfaces listings a name search misses, including listings under former names.
3. Record every listing found: source, the exact name/address/phone as displayed, and whether each matches canonical.
4. Classify each mismatch: outdated (a real former value), typo, formatting-only, or duplicate/merged listing. These carry different severity and need different fixes.
5. Look specifically for legacy **C&J Auto Rebuilders** listings. A 40-year South Side history means predecessor-name records plausibly exist and may still be propagating — check rather than assume, and classify what is found.
6. Flag duplicate listings for the location; duplicates are typically more damaging than a formatting variance and harder to remove.
7. Trace where inconsistent data propagates from. One wrong aggregator record can feed dozens of downstream listings — fixing the origin is worth more than fixing copies. Cross-reference AM-026.
8. Separate correctness fixes (high value) from net-new listing opportunities (unproven value, `SC-07`).

## Guards

- `SC-07` — do not conflate consistency with count. Fix consistency first and measure it before adding listings.
- Formatting-only variance is real but low severity; do not report it at the weight of a wrong phone number.
- Fix the propagation origin or the inconsistency returns.
- `FROZEN_CHANGES` prohibits contacting directories. This module **identifies and documents**; it does not submit, claim, or correct anything.
- Some directories are low-quality; adding listings there is not a neutral act.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `SOURCE / DIRECTORY`
- `NAME AS LISTED`
- `ADDRESS AS LISTED`
- `PHONE AS LISTED`
- `MISMATCH TYPE (outdated / typo / format / duplicate / none)`
- `LEGACY C&J RECORD?`
- `PROPAGATION ORIGIN (if known)`
- `SEVERITY`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Count of inconsistent listings and count of duplicates outstanding, re-checked 60 days after an approved correction batch — aggregator propagation is slow and a 28-day check reads as failure regardless of outcome.

## Handoff

One Decision Queue row per finding — `category` = `Local SEO`, module `AM-009`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
