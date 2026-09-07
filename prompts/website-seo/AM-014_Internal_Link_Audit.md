# AM-014 — Internal Link Audit

**Family:** Website SEO · **Module ID:** `AM-014` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Map how internal linking distributes crawl access and topical signal, and whether the engine pages are actually well-connected. Internal linking is the cheapest, most reversible lever available on a small site.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Crawl link graph from AM-010
- Money-page list from AM-012
- Navigation, footer, and in-body link inventories, kept separate

## Procedure

1. Build the internal link graph and compute inbound internal links per URL, **separating template links (nav/footer) from in-body contextual links**. Pooling them makes every page look equally linked and hides the finding.
2. Identify engine pages with few or no contextual inbound links. This is the most common high-value finding here.
3. Identify orphan pages and near-orphans reachable only from the sitemap or deep pagination.
4. Compute click depth from the homepage to each money page. Depth greater than three on a small site usually indicates a structural problem.
5. Audit anchor text on contextual links into engine pages: descriptive of the destination, or generic?
6. Identify pages with inbound authority but no onward links to engine pages — the cheapest wins available.
7. Flag over-linked pages where each link's value is diluted and the page reads as an unedited hub.

## Guards

- Separate template links from contextual links, always.
- Internal linking is reversible and low-risk, which makes it the right first lever — but it cannot make a page deserve to rank.
- Do not recommend exact-match anchor text at scale. Descriptive and varied is the standard.
- Navigation changes affect every page; treat them as higher risk than in-body links.
- Durable may constrain where in-body links can be placed. Verify controllability before proposing.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `TARGET PAGE`
- `CONTEXTUAL INBOUND LINKS`
- `TEMPLATE INBOUND LINKS`
- `CLICK DEPTH`
- `ANCHOR TEXT QUALITY`
- `PROPOSED SOURCE PAGES`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Contextual inbound link count and click depth for each engine page, plus that page's impressions and position, 28 days after an approved batch.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-014`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
