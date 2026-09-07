# AM-023 — Competitor Backlink Gap

**Family:** Authority · **Module ID:** `AM-023` — matches the `AuditModule` record in `src/data/seed.ts` · **Version:** 1.0

## Purpose

Compare referring domains against the competitor dossiers to identify domains linking to competitors but not to Boltz — filtered to those that are legitimate, achievable, and worth pursuing. The output is a qualified target list with a reason for each, not a raw gap export.

## Preconditions

- Load the Context Lock (`src/data/context.ts`): canonical NAP, services, history, commercial priorities, frozen changes.
- Check the Experiment Registry before recording any finding. A finding touching a surface under an active experiment is `HOLD FOR EXPERIMENT` with the experiment cited — never recalled from memory.
- **This module is read-only.** It observes; it changes nothing. Every item in `FROZEN_CHANGES` applies.

## Inputs

- Backlink profiles for Boltz and each competitor, from the **same tool on the same date** — tools disagree substantially
- Competitor set with inclusion basis
- Source type taxonomy from `ProvenanceRecord`

## Procedure

1. Export referring domains for Boltz and each competitor from one tool on one date. Cross-tool comparison is not valid.
2. Build the gap set: domains linking to one or more competitors but not to Boltz.
3. **Classify each by source type and collapse derivatives.** Syndicated network copies of one placement are one origin — this is where most backlink gap reports inflate.
4. Filter out link networks, paid-link marketplaces, scraped or auto-generated directories, and anything clearly transactional. These are risks, not targets.
5. For surviving domains, classify the link's origin: local editorial, chamber or community organization, supplier or parts-network relationship, sponsorship, resource page, or user-generated. The acquisition path differs entirely by type, and this is the useful part of the analysis.
6. Give particular attention to genuinely local Chicago and South Side sources — community organizations, local news, neighborhood associations. For a single-location shop with a 40-year local history, these are both more achievable and more relevant than national automotive domains.
7. Mark achievability honestly. Most gap domains are not achievable; marking `false` freely is what makes the list useful.
8. Cross-reference AM-018: domains that are both link sources and AI-retrieval sources are the highest-value targets available.

## Guards

- Backlink tools have partial, differing indexes. Never present tool data as complete; name the tool and date.
- **`FROZEN_CHANGES` prohibits creating backlinks and contacting directories.** This module identifies and qualifies targets; it does not pursue them. Any outreach is a separate, owner-approved action.
- Never propose buying links, PBNs, link exchanges at scale, or paid placements presented as editorial. Hard stop.
- Domain authority metrics are vendor inventions, not search-engine signals. Use them for coarse sorting only, and say so.
- A competitor's link may come from a relationship that cannot be replicated. Achievability is a real filter.

## Output

Findings use the shape in `docs/methodologies/MODULE_OUTPUT_CONTRACT.md`. Module-specific fields:

- `DOMAIN`
- `LINKS TO WHICH COMPETITORS (n)`
- `SOURCE TYPE`
- `INFORMATION ORIGIN`
- `LINK ORIGIN (editorial / community / supplier / sponsorship / resource / UGC)`
- `LOCAL TO CHICAGO / SOUTH SIDE?`
- `ACHIEVABLE LEGITIMATELY?`
- `ALSO AN AI-RETRIEVAL SOURCE? (from AM-018)`
- `TOOL + DATE`

Remember the null / 0 rule: a value never measured is `null` ("Not entered"); `0` means measured zero.

## Next measurement

Referring domains from distinct information origins, quarterly. Link acquisition is slow and a monthly read is noise.

## Handoff

One Decision Queue row per finding — `category` = `Authority`, module `AM-023`. Opportunity Score is computed
by `opportunityScore()` in `src/data/types.ts`; do not hand-calculate it.
