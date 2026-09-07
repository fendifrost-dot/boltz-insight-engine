# Speculative Claims Register

The claims listed in `SPECULATIVE_CLAIMS` (`src/data/context.ts`) enter this system as **HYPOTHESIS with
a named test**, never as fact. This file gives each one the test that would settle it.

A claim leaves this register in one of two directions: promoted to CONFIRMED by a registered experiment
that met its pre-declared success criterion, or rejected with the failing evidence recorded. Nothing
leaves by repetition or consensus.

| ID      | Claim                                                         | Status     | Named test                                                                                                                                                                               | Falsifier                                                                                                                       |
| ------- | ------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `SC-01` | GBP posting frequency directly causes ranking improvement     | HYPOTHESIS | Interrupted time series: fixed posting cadence 8 weeks, **all other GBP fields frozen**; measure non-branded Map Pack impressions and discovery searches against the pre-period baseline | No change beyond baseline variance, or the change tracks a confounder (seasonality, review influx, competitor churn)            |
| `SC-02` | Keyword-rich owner review responses directly improve rankings | HYPOTHESIS | Split by review cohort: service-term-bearing responses vs plain responses, 8+ weeks; compare category-query visibility                                                                   | No divergence between cohorts                                                                                                   |
| `SC-03` | Photo geotags materially improve rankings                     | HYPOTHESIS | **Test the mechanism first:** upload one image with known EXIF GPS, re-download from the profile, inspect whether EXIF survived. If stripped, the claim is mechanically dead → REJECTED  | EXIF stripped on upload, or matched geotagged/stripped sets show no divergence over 6+ weeks                                    |
| `SC-04` | Competitor categories should be copied automatically          | HYPOTHESIS | Never test by blind copying. Test one _justified_ secondary category matching a service Boltz actually performs, hold others fixed, 8 weeks                                              | Visibility flat or down — **or** the category misdescribes the business, which is an automatic reject regardless of measurement |
| `SC-05` | Review velocity always outweighs total review count           | HYPOTHESIS | Observational across the competitor set: correlate position against velocity and against total count **separately**; needs ≥15 competitors to mean anything                              | Total count explains position at least as well as velocity                                                                      |

Two further claims are implied by GEO work and are recorded here so they are not assumed:

| ID      | Claim                                                            | Status     | Named test                                                                                                                            | Falsifier                                                     |
| ------- | ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `SC-06` | AI citation requires top organic presence                        | HYPOTHESIS | For the panel prompts, record cited sources and their organic positions; measure overlap                                              | Frequent citation of sources outside the top organic set      |
| `SC-07` | More directory listings improve local ranking beyond consistency | HYPOTHESIS | Separate _consistency_ from _count_: fix NAP inconsistencies first and measure; only then add net-new listings and measure separately | Consistency fixes move the metric and net-new listings do not |

## Rules

1. **Citing this register is mandatory** when a module output touches one of these claims. The finding
   carries `CLAIM CLASS: HYPOTHESIS` and `CONFIDENCE: LOW`.
2. **No stacking.** Never deploy several speculative tactics at once and attribute the result to one.
   That produces an unreadable experiment and is the most common way local SEO fools itself.
3. **Promotion requires a registered experiment** with a success criterion declared _before_ deployment.
   Post-hoc reinterpretation of a failed test does not promote a claim.

## Hard stops — excluded on principle, not pending evidence

Never propose, script, or encourage: asking customers to insert predetermined keywords into reviews ·
incentivized or gated reviews · fabricated testimonials · fake or misdescriptive GBP categories ·
manufactured citations or press · paid links presented as editorial · any tactic whose value depends on a
platform not noticing it.
