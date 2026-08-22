# Module Output Contract

Every module in `prompts/` returns findings in this shape. Uniform output is what lets findings from
different modules land in one Decision Queue without re-interpretation.

One finding = one block. A module run returns N blocks plus one coverage statement.

Field names and allowed values map directly onto `DecisionRecord` in `src/data/types.ts`. Where this
document and the type definitions disagree, **the types are authoritative** — update this file.

---

## Required fields per finding

```
FINDING:              What was found. Specific and falsifiable.
DATE:                 YYYY-MM-DD
SOURCE:               Evidence origin — URL / export / tool, plus sampling limits.
CATEGORY:             Module family or surface.
CLAIM CLASS:          OWNER-CONFIRMED | CONFIRMED | OBSERVED | HYPOTHESIS | UNKNOWN
SEO IMPACT:           HIGH | MEDIUM | LOW
GEO IMPACT:           HIGH | MEDIUM | LOW
ENGINE JOB RELEVANCE: HIGH | MEDIUM | LOW
COMMERCIAL VALUE:     HIGH | MEDIUM | LOW
CONFIDENCE:           HIGH | MEDIUM | LOW
EFFORT:               HIGH | MEDIUM | LOW
TIME TO SIGNAL:       e.g. "28 days" — or null if unknown
CONTAMINATION RISK:   HIGH | MEDIUM | LOW   (checked against the Experiment Registry)
REVERSIBLE:           true | false | null
PROPOSED ACTION:      What to do. "Nothing yet" is a legitimate answer.
STATUS:               RESEARCH NOW | PREPARE NOW | READY FOR REVIEW | APPROVED | DEPLOYED
                      | HOLD FOR EXPERIMENT | REJECTED
DEPLOYMENT STATE:     RESEARCH ONLY | PREPARED | APPROVED | DEPLOYED | HELD | REJECTED
MEASUREMENT DATE:     The date the outcome gets re-checked. Set before deployment, never after.
```

`APPROVED`, `DEPLOYED`, `deploymentBatch`, `deploymentDate` and `outcome` are **owner-set**. A module
never writes them. A module proposes; it does not approve.

## Coverage statement — once per run

```
MODULE:          AM-0xx
RUN DATE:        YYYY-MM-DD
SCOPE INSPECTED: e.g. "18 of 42 URLs (sitemap-ordered, first 18)"
NOT INSPECTED:   What was skipped, and why
TOOLS USED:      Name them — different tools disagree
BLOCKERS:        Access, rate limits, missing exports
```

Coverage gaps are findings. Silent sampling reads as full coverage and corrupts every decision built on it.

## The null / 0 rule

**A value never measured is `null` and renders as "Not entered". `0` means measured zero.** The
distinction is load-bearing throughout this system: `null` says _we do not know_, `0` says _we looked and
there were none_. Never write `0` to mean "unknown", and never let a `null` be summed, averaged, or
charted as zero.

## Field discipline

- **SEO IMPACT and GEO IMPACT are separate axes** and routinely diverge. A robots.txt rule can be LOW for
  SEO and HIGH for retrieval.
- **ENGINE JOB RELEVANCE is its own field**, not a restatement of commercial value. Engine replacement is
  commercial priority #1; a finding can be commercially valuable and still engine-irrelevant.
- **CONFIDENCE is about the inference, not the observation.** CONFIRMED evidence with LOW confidence in
  what it implies is a normal, expected pairing — do not smooth it into something firmer.
- **CONTAMINATION RISK is checked against the Experiment Registry**, not recalled. Cite the experiment.
- **REVERSIBLE is `false` for anything that resets a baseline** — URL changes, GBP category changes.

## Handoff

Every finding becomes one Decision Queue row. A module run is not complete until the queue is updated.
Opportunity Score is computed by `opportunityScore()` in `src/data/types.ts` from the impact fields — do
not hand-calculate it or invent a competing formula.
