# Prompt Modules

Executable procedures for the 27 audit modules registered as `AuditModule` records in
`src/data/seed.ts`. Module IDs here match that array exactly (`AM-001`–`AM-027`), so a module shown in
the `/modules` route has its full procedure in this directory.

## Running a module

```
Run AM-011 and update the Decision Queue.
Run AM-017 for the Google AI and Perplexity platforms — baseline run.
Run AM-001 + AM-003 and record findings.
```

Each run: load the Context Lock (`src/data/context.ts`), check the Experiment Registry for contamination,
execute read-only, return findings per `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`, append Decision
Queue rows.

## Every module is read-only

No module deploys anything. `FROZEN_CHANGES` in the Context Lock applies to all of them: no changes to
boltzautogarage.com, Durable, DNS, or the GBP; no published pages; no contacting competitors or
directories; no soliciting reviews; no created backlinks, citations, reviews, or accounts.

Findings flow: **research → hypothesis → proposed intervention → approval → deployment → measurement.**
Competitor observation never becomes a production change directly.

## Dependency order

Some modules are instruments others read from. Out of order, the dependents are uninterpretable:

| Run first                       | Because                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `AM-017` AI Visibility Panel    | Creates the frozen prompt panel that `AM-018`–`AM-022` all read from      |
| `AM-010` Technical Crawl        | Produces the crawl that `AM-012`–`AM-016` consume                         |
| `AM-018` Retrieval Source Map   | Feeds `AM-019`, `AM-023`, `AM-025`, `AM-026`, `AM-027`                    |
| `AM-024` Source Ancestry        | Required by `AM-027` — without collapsed origins the count is meaningless |
| `AM-011` GSC Opportunity Mining | Blocked until GSC access is confirmed (open Context Lock question)        |

## Methodology

- [`docs/methodologies/MODULE_OUTPUT_CONTRACT.md`](../docs/methodologies/MODULE_OUTPUT_CONTRACT.md) — the finding shape, and the null / 0 rule
- [`docs/methodologies/EVIDENCE_CLASSIFICATION.md`](../docs/methodologies/EVIDENCE_CLASSIFICATION.md) — `ClaimClass` definitions
- [`docs/methodologies/SPECULATIVE_CLAIMS_REGISTER.md`](../docs/methodologies/SPECULATIVE_CLAIMS_REGISTER.md) — `SC-01`–`SC-07`, the claims treated as hypotheses with named tests

---

## Local SEO — `local-seo/`

| Module                                                          | Name                              | Purpose                                                                             |
| --------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| [`AM-001`](local-seo/AM-001_GBP_Category_Audit.md)              | GBP Category Audit                | Record live primary/secondary categories and compare against engine-intent demand.  |
| [`AM-002`](local-seo/AM-002_GBP_Attributes_Audit.md)            | GBP Attributes Audit              | Inventory attributes present vs available for automotive repair.                    |
| [`AM-003`](local-seo/AM-003_GBP_Services_Audit.md)              | GBP Services Audit                | Check engine replacement service items exist and are named as customers search.     |
| [`AM-004`](local-seo/AM-004_Review_Velocity_Audit.md)           | Review Velocity Audit             | Measure review arrival rate over time (count and cadence tracked separately).       |
| [`AM-005`](local-seo/AM-005_Review_Language_Sentiment_Audit.md) | Review Language / Sentiment Audit | Theme reviews; detect engine-job language presence. Never solicit scripted wording. |
| [`AM-006`](local-seo/AM-006_Review_Response_Audit.md)           | Review Response Audit             | Assess response coverage and tone. Ranking effect treated as hypothesis.            |
| [`AM-007`](local-seo/AM-007_GBP_Posts_Audit.md)                 | GBP Posts Audit                   | Log posting cadence. Causal ranking claim is a hypothesis, not a fact.              |
| [`AM-008`](local-seo/AM-008_GBP_Photo_Audit.md)                 | GBP Photo Audit                   | Inventory photo coverage by service line. Geotag effect is a hypothesis.            |
| [`AM-009`](local-seo/AM-009_Citation_Consistency_Audit.md)      | Citation Consistency Audit        | Compare NAP across directories against the canonical record.                        |

## Website SEO — `website-seo/`

| Module                                                   | Name                   | Purpose                                                                    |
| -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| [`AM-010`](website-seo/AM-010_Technical_Crawl_Audit.md)  | Technical Crawl Audit  | Crawl boltzautogarage.com read-only for indexability and structure issues. |
| [`AM-011`](website-seo/AM-011_GSC_Opportunity_Mining.md) | GSC Opportunity Mining | Find impression-rich, click-poor queries once GSC data is imported.        |
| [`AM-012`](website-seo/AM-012_Money_Page_Audit.md)       | Money Page Audit       | Evaluate engine-replacement pages for intent match and conversion path.    |
| [`AM-013`](website-seo/AM-013_Query_Gap_Audit.md)        | Query Gap Audit        | Compare Query Universe coverage to existing pages.                         |
| [`AM-014`](website-seo/AM-014_Internal_Link_Audit.md)    | Internal Link Audit    | Map link equity flow toward engine pages.                                  |
| [`AM-015`](website-seo/AM-015_CTR_Snippet_Audit.md)      | CTR / Snippet Audit    | Compare CTR vs position to isolate snippet problems.                       |
| [`AM-016`](website-seo/AM-016_Content_Gap_Audit.md)      | Content Gap Audit      | Identify unserved clusters weighted by engine value.                       |

## GEO / AI — `geo-ai/`

| Module                                                    | Name                         | Purpose                                                                            |
| --------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| [`AM-017`](geo-ai/AM-017_AI_Visibility_Panel.md)          | AI Visibility Panel          | Run the standard query set per platform and record one structured row per test.    |
| [`AM-018`](geo-ai/AM-018_Retrieval_Source_Map.md)         | Retrieval Source Map         | Capture which URLs each platform retrieved before answering.                       |
| [`AM-019`](geo-ai/AM-019_Source-to-Mention_Conversion.md) | Source→Mention Conversion    | Rate at which source presence converts to a direct Boltz mention.                  |
| [`AM-020`](geo-ai/AM-020_Entity_Accuracy_Audit.md)        | Entity Accuracy Audit        | Check NAP, hours and service claims stated by AI systems against the context lock. |
| [`AM-021`](geo-ai/AM-021_Platform_Share_of_Voice.md)      | Platform Share of Voice      | Per-platform competitor mention share. Never blended into one score.               |
| [`AM-022`](geo-ai/AM-022_Service_Association_Tracking.md) | Service Association Tracking | Whether AI associates Boltz with engine replacement specifically.                  |

## Authority — `authority/`

| Module                                                          | Name                            | Purpose                                                  |
| --------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| [`AM-023`](authority/AM-023_Competitor_Backlink_Gap.md)         | Competitor Backlink Gap         | Compare referring domains against competitor dossiers.   |
| [`AM-024`](authority/AM-024_Source_Ancestry_Audit.md)           | Source Ancestry Audit           | Trace syndicated/derivative sources to their original.   |
| [`AM-025`](authority/AM-025_Editorial_Node_Map.md)              | Editorial Node Map              | Identify genuinely editorial local sources.              |
| [`AM-026`](authority/AM-026_Directory_Citation_Map.md)          | Directory/Citation Map          | Map directory presence and control status.               |
| [`AM-027`](authority/AM-027_Independent_Corroboration_Audit.md) | Independent Corroboration Audit | Count only non-duplicated, non-syndicated corroboration. |

---

## Speculative claims these modules must not assert

`AM-007` (posting cadence), `AM-006` (review-response wording), `AM-008` (photo geotags), `AM-001`
(copying competitor categories), and `AM-004` (velocity vs count) each touch a claim in the Speculative
Claims Register. Findings from those modules carry `CLAIM CLASS: HYPOTHESIS` and `CONFIDENCE: LOW`, and
cite the `SC-xx` id.

`AM-008` can close `SC-03` outright in minutes: upload one image with known EXIF, re-download, check
whether the geotag survived. If it is stripped, the claim is mechanically dead.
