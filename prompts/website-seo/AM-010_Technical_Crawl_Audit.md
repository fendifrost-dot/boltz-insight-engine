# AM-010 — Technical Crawl Audit

**Family:** Website SEO · **Module ID:** `AM-010` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Establish the actual technical state of boltzautogarage.com from a full read-only crawl: what exists, what is reachable, what is indexable, and what is broken. Every other website module depends on this being current and being a crawl rather than a recollection.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.
- The site is on **Durable** and is explicitly frozen. Crawling is read-only and permitted; modifying, migrating, or republishing anything is not.
- Store the crawl as a dated artifact under `data/baselines/`. Later modules diff against it, and historical artifacts are append-only.
- Durable is a hosted site builder — control over robots, redirects, and markup may be limited. Record what is actually controllable rather than assuming full access.

## Inputs

- Full crawl of boltzautogarage.com — all templates, not a sample
- XML sitemap(s) and robots.txt
- Index coverage report, if GSC access exists
- A render-mode check: does key content require JavaScript?

## Procedure

1. Crawl the full site. Record the URL inventory: status codes, titles, meta descriptions, canonicals, headings, word counts, internal link counts.
2. Diff the crawl inventory against the sitemap in both directions — sitemap URLs that do not exist, and live URLs absent from the sitemap.
3. Record every non-200: 404s, redirect chains and loops, 5xx, soft-404s.
4. Check indexability directives (robots.txt, meta robots, canonicals) and flag anything blocked or canonicalized away that should be indexed — **and the reverse**, anything indexable that should not be.
5. Test render mode: fetch key templates with JavaScript disabled and record what disappears. Content existing only after JS is a retrieval risk for AI crawlers that do not execute it, which makes this a GEO finding as much as an SEO one.
6. Record duplicate or near-duplicate titles, meta descriptions, and H1s at **template** level, not just page level.
7. Locate and assess the engine-replacement pages specifically — their technical state feeds AM-012 and is commercial priority #1.
8. Check HTTPS, redirect consistency (www/non-www, trailing slash), and that one canonical host serves everything.
9. Record Core Web Vitals or field data where available.

## Guards

- Crawl the full site. A partial crawl reported as a site audit is the quiet lie of this discipline — if you sample, state it in SCOPE INSPECTED.
- A crawler is not a browser. Confirm JS-rendered content separately.
- Separate **blocking** issues (indexability, broken engine pages) from **hygiene** (a long meta description). Reporting them at equal weight buries the real finding.
- Never propose a site-wide structural change from this module alone — URL changes reset every baseline simultaneously and are `reversible: false`.
- Durable may not expose the controls a fix would require. Verify controllability before proposing anything, or the recommendation is unactionable.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `ISSUE TYPE (indexability / availability / duplication / render / performance / hygiene)`
- `URLS AFFECTED (count + examples)`
- `BLOCKING OR HYGIENE?`
- `TEMPLATE-LEVEL OR PAGE-LEVEL?`
- `AI-CRAWLER IMPACT (what a non-JS retriever sees)`
- `CONTROLLABLE ON DURABLE?`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Re-crawl 28 days after any approved fix batch; diff URL inventory, status-code distribution, and indexable-page count against the stored baseline crawl.

## Handoff

One Decision Queue row per finding — `category` = `Website SEO`, module `AM-010`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
