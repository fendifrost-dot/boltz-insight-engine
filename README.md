# Boltz SEO-GEO Ops

Internal research, measurement, planning and experiment-management system for
**Boltz Automotive Inc.**

This is **not** a website rebuild. The public Boltz site remains
`https://boltzautogarage.com` on Durable. Nothing in this repo modifies that
site, DNS, or the Google Business Profile.

## Core question

> What is making Boltz visible or invisible across Google, Maps, AI systems and
> local automotive search — and which controlled interventions produce more
> qualified engine-replacement business?

Commercial priority: **engine replacement growth**. Capacity can expand with demand.

## Workflow (enforced by the data model)

```
finding (Decision Queue)
  -> hypothesis + proposed intervention
  -> approval (owner)
  -> experiment registration (baseline preserved, intervention isolated)
  -> deployment (separately authorized)
  -> measurement (business outcome, not just rankings)
```

Competitor observation never becomes a production change directly.

## Data conventions

- Unmeasured fields are `null` and render as **"Not entered"**.
- `0` means **measured zero**. The distinction is load-bearing.
- Claim classes: OWNER-CONFIRMED / CONFIRMED / OBSERVED / HYPOTHESIS / UNKNOWN.
- Deployment states: RESEARCH ONLY / PREPARED / APPROVED / DEPLOYED / HELD / REJECTED.
- Duplicated or syndicated sources are never counted as independent corroboration.

## Opportunity score

```
(SEO/GEO opportunity x commercial value x engine-job value x confidence) / effort
```

All factors are displayed alongside the score — no black box.

## App structure

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: active experiments, checkpoints, top opportunities, engine funnel |
| `/context` | Context Lock — canonical NAP, services, history, priorities, frozen changes |
| `/decisions` | Decision Queue — findings, scoring, approval, deployment, outcome |
| `/experiments` | Experiment Registry — hypotheses, baselines, controls, checkpoints, lock |
| `/measurement` | Business-outcome metrics (funnel, engagement, search, AI) |
| `/queries` | Query Universe — clusters, intent, engine relevance, visibility |
| `/ai-visibility` | Per-platform AI visibility runs (never blended) |
| `/local-seo` | GBP / reviews / Map Pack / GSC observation surfaces |
| `/competitors` | Competitor dossiers |
| `/provenance` | Source Provenance Ledger |
| `/modules` | Reusable audit module index |

Code: `src/data/` (model + seed + context lock), `src/lib/store.ts`
(persistence layer — swappable for Lovable Cloud later), `src/routes/`,
`src/components/ops/`.

## Repository layout

```
boltz-seo-geo-ops/
├── docs/        context, competitors, experiments, methodologies, handoffs, reports
├── data/        baselines, queries, measurements, competitors, provenance, decisions
├── prompts/     local-seo, website-seo, geo-ai, authority
├── src/         application (components, routes, lib, data)
└── README.md
```

Historical data is append-only. Do not overwrite or delete prior artifacts.

## Git workflow

- `main` holds stable internal releases.
- Feature work happens on branches where practical.
- Methodology changes are recorded in `docs/methodologies/`.
- No auto-deploy of experimental changes.

## Guardrails

Do not: modify boltzautogarage.com, migrate Durable, alter DNS, change GBP,
publish pages, contact competitors or directories, solicit reviews, create
backlinks/citations/reviews/accounts, or push any production change.

Never ask customers to insert predetermined keywords into reviews.
