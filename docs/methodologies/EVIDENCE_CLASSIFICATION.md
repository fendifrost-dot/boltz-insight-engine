# Evidence Classification

Every claim carries exactly one `ClaimClass`. Values are defined in `src/data/types.ts`.

| Class | Means | Requires | Example |
|---|---|---|---|
| `OWNER-CONFIRMED` | Asserted by Boltz. Authoritative for business facts, **not** for market facts | Who said it, when | "Last regular appointment approximately 4 PM" |
| `CONFIRMED` | Directly verified by inspecting the artifact, with a citable source | URL, export, screenshot, API response + date | "The site returns 200 at `/` — crawled 2026-08-22" |
| `OBSERVED` | Seen, but not proven stable, causal, or complete | What was seen, when, sampling limits | "Competitor A appeared in 3 of 5 Perplexity answers on 2026-08-22" |
| `HYPOTHESIS` | Plausible, unproven, **and has a named test** | The test + what result falsifies it | "Adding engine-cost content lifts non-branded impressions — test: E-xx" |
| `UNKNOWN` | Not yet checked, or checked and indeterminate | What would resolve it | "Live GBP primary category — not yet retrieved" |

## Rules

1. **A HYPOTHESIS without a named test is noise.** Write the test or drop the claim.
2. **Never let a HYPOTHESIS read as CONFIRMED.** No hedging that implies proof.
3. **OWNER-CONFIRMED covers business facts only** — NAP, hours, services, history, priorities. It is not
   authority on what ranks or what AI systems say.
4. **Downgrade on doubt.** Between two classes, take the weaker.
5. **Date every CONFIRMED and OBSERVED claim.** SERPs and AI answers decay fast; an undated observation
   becomes UNKNOWN within weeks.
6. **Absence of evidence is UNKNOWN**, not a confirmed negative — unless the check was exhaustive and you
   say so.
7. **Never invent history.** The C&J Auto Rebuilders legacy (South Side, approximately 1982) is the
   recorded history; no additional history is to be constructed for narrative or content purposes.
