# Google Ads "Ads Weekly" reporting — inventory + V1 implementation

Date: 2026-09-21
Scope: read-only weekly Search Terms + Keywords reporting for the Monday agent,
working with Chrome fully logged out and closed.

---

## 1. Phase 1 inventory

### What I could and could not inspect

I inventoried the **repository** directly and completely. I could **not** query the
live Lovable Cloud / Supabase backend from this session: it carries no
`SUPABASE_*`, `GOOGLE_ADS_*`, or `CRON_SECRET` values (verified — zero matching
environment variables), and per the chain-of-command rule there is no standalone
Supabase to log into. So the live-backend findings below are **inferred from
repository evidence**, not read off the deployed project. Section 6 lists the
three things Fendi should confirm in Lovable to close that gap.

### Edge Functions

**None found, and no evidence any exist.**

- There is no `supabase/functions/` directory — confirmed on local `main` and via
  the GitHub API on `refs/heads/main` (`supabase/` contains only `config.toml`
  and `migrations/`).
- Stronger signal: **zero** occurrences of `functions.invoke`, `/functions/v1/`,
  or any Edge Function URL anywhere in `src/`, `docs/`, `prompts/`, or
  `scripts/`. A deployed-but-unversioned Edge Function would normally leave a
  caller behind in the app. Nothing calls one.
- All server-side work in this app runs through TanStack Start instead: server
  functions (`createServerFn`) and `src/routes/api/public/*` route handlers.

### SQL functions / RPCs

No Google Ads, OAuth, GAQL, or outbound-HTTP logic in SQL.

- RPCs actually called from the app: `has_role`, `is_staff`,
  `read_agent_auth_secret`. None Ads-related.
- No `pg_net`, no `net.http_*`, no external API wrappers in any migration.

### Cron / scheduled jobs

No database-level scheduling exists.

- No `pg_cron`, no `cron.schedule` in any migration. The only extension created
  is `pgcrypto`.
- Cron is **HTTP-invoked**: `POST /api/public/cron/{process-jobs,
  reconcile-messages, renew-subscriptions}`, each gated by a
  `Authorization: Bearer <CRON_SECRET>` check in
  `src/server/lead-inbox/cron.server.ts` (`authorizeCron`, constant-time compare).
- The **schedule itself lives outside the repo** (Lovable scheduled jobs or an
  external caller). Nothing in git schedules these, so the new endpoint will need
  a Monday trigger wired the same way the existing three are. See section 6.

### Vault / secrets

Google Ads credentials are read from **server-side environment variables**, not
Vault.

- `src/server/google-ads/env.server.ts` reads `process.env` only, via
  `readAdsSecret` / `requireAdsSecret`.
- Supabase Vault is used in exactly one place and for an unrelated purpose:
  `public.write_agent_auth_secret` (migration `20260905151058`), hard-restricted
  to `AGENT_AUTH_EMAIL` / `AGENT_AUTH_PASSWORD`, `service_role` only.
- So: Ads secrets are **Lovable Cloud secrets → `process.env`**. No values were
  read, printed, or logged at any point in this work.

### Existing data tables

**No Ads tables exist.** Full table list across all migrations:

`agent_runs`, `escalations`, `integration_health_snapshots`, `lead_events`,
`leads`, `message_jobs`, `message_threads`, `messages`,
`ringcentral_subscriptions`, `user_roles`.

Nothing resembling `google_ads_*`, `ads_*`, `search_terms`, `keywords`,
`campaign_metrics`, or `ads_weekly`. There is no reporting/snapshot history table.

---

## 2. Which Google Ads path is live

**Case B — there is exactly one Google Ads implementation, and it is the
TanStack server path in this repo.** No duplicate to retire, no second client to
reconcile. The drift risk the handoff was worried about does not exist yet, and
this change does not create it.

Live path today:

```
src/lib/google-ads.functions.ts        (owner-gated server fns, UI-facing)
  └── src/server/google-ads/client.server.ts   (OAuth refresh, GAQL searchStream, redaction, adsMutate)
        └── src/server/google-ads/env.server.ts  (process.env secret access, masking)
```

Consumed by `src/routes/_authenticated/ads.tsx` via `getAdsStatus` /
`getAdsPerformance`. Writes go through `adsMutate`, which is gated by an explicit
confirmation flag **and** the change-control freeze.

---

## 3. What I reused vs. added

**Reused unchanged** (no duplication):

- `adsSearch` — OAuth refresh-token auth, developer token, optional
  `login-customer-id`, customer-ID normalization, token caching, `searchStream`
  execution, provider-error redaction.
- `authorizeCron` — the existing `CRON_SECRET` bearer check. No second auth
  mechanism was introduced.
- The `src/routes/api/public/cron/*.ts` route shape, including its
  try/catch-to-500 behavior.

**Added** (the smallest missing piece):

| File | Purpose |
|---|---|
| `src/server/google-ads/report-period.ts` | Pure reporting-window math. No imports, no I/O, no secrets. |
| `src/server/google-ads/reports.server.ts` | `getWeeklySearchTerms()`, `getWeeklyKeywords()`, `getAdsWeeklyReport()`, `getAdsAccountInfo()`. |
| `src/routes/api/public/cron/ads-weekly.ts` | `POST /api/public/cron/ads-weekly`. |
| `src/server/google-ads/weekly-report-readonly.test.ts` | 17 tests, incl. the read-only proof. |

**Explicitly not duplicated / not built:** no second Google Ads client, no second
auth mechanism, no MCP server, no Edge Function, no SQL/`pg_net` path, no
migration, no Ads warehouse table, no Ads-management UI, no recommendation engine,
no mutation code.

No MCP was added. Boltz already owns a working direct API client, so the
`googleads/google-ads-mcp` route would have added a hop and a second credential
surface for no capability gain. Revisit only if external agents need broad ad-hoc
GAQL.

---

## 4. The endpoint

```
POST /api/public/cron/ads-weekly
Authorization: Bearer <CRON_SECRET>
```

Optional `?days=N` (integer 1–90, default 7) sets only the lookback length. The
GAQL is fixed server-side; the Monday agent cannot supply query text.

Status codes: `200` report · `400` bad `days` · `401` bad/missing bearer ·
`503` Ads secrets not configured (operator-actionable, lists missing names only) ·
`500` provider/transport failure (message already redacted).

### Response shape

```jsonc
{
  "period":  { "start": "2026-09-14", "end": "2026-09-20", "days": 7, "time_zone": "America/Chicago" },
  "account": { "customer_id": "...", "descriptive_name": "...", "currency_code": "USD" },
  "search_terms": [ /* date, campaign_id/name, ad_group_id/name, search_term,
                      search_term_status, keyword_text, match_type,
                      impressions, clicks, cost_micros, conversions, conversions_value */ ],
  "keywords":     [ /* ... plus criterion_id, keyword_text, match_type, status */ ],
  "summary": {
    "search_term_rows": 0, "keyword_rows": 0, "impressions": 0, "clicks": 0,
    "cost_micros": 0, "conversions": 0, "conversions_value": 0, "truncated": false
  },
  "resources": { "search_terms": "search_term_view", "keywords": "keyword_view" },
  "notes": [ "..." ],
  "generated_at": "2026-09-21T15:04:05.000Z"
}
```

Three deliberate additions to the handoff's schema, all to keep the report honest
rather than merely well-formed:

1. **`period.time_zone` and explicit `start`/`end` dates.** The window is
   resolved to real calendar dates **in the account's time zone** (read from
   `customer.time_zone`), not left as a relative `LAST_7_DAYS` literal and not
   computed in the server's UTC clock. A container running UTC would otherwise
   silently report a different week than the Ads UI shows. Semantics match
   Google's: the window ends **yesterday**, so a partial current day never lands
   in a report.
2. **`resources`** — names the GAQL resource behind each list, so
   `search_term_view` rows can never be mistaken for `campaign_search_term_view`
   (Performance Max) rows. PMax is deliberately **not** unioned in; if Monday
   needs it, add it as its own list with its own tag.
3. **`summary.truncated` + `notes`** — each report is capped at 5000 rows. If a
   cap is hit, `truncated` is `true` and a note says the totals are partial and
   must not be reconciled against the UI.

**Summary totals come from `keyword_view`.** Search-term rows cover the same
spend, so adding both would double count. This means the summary is
keyword-attributed spend, not total account spend — it will legitimately differ
from an all-campaigns UI total when non-keyword inventory (PMax, Display, DSA) is
running. This is stated in `notes` on every response.

An account with no activity returns empty arrays and zero totals with `200`. That
is a valid report, not a failure.

---

## 5. Verification actually performed

Run in this session:

- **Full test suite: 100/100 pass** (`bun run test`), including the 17 new tests.
  The new file is registered in the `test` script.
- **Typecheck clean** against the repo's real `tsconfig.json` — which is strict
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`). Zero errors in the new files.
- **Route tree regenerated** by the TanStack router plugin; `ads-weekly` is
  registered in `src/routeTree.gen.ts`.
- **Prettier clean** on all new files.

The read-only guarantee the handoff asked for is enforced statically, not just by
convention. `weekly-report-readonly.test.ts` asserts that neither
`reports.server.ts` nor the cron route references `adsMutate`, that
`reports.server.ts` imports **exactly** `adsSearch` and `adsCustomerId` from the
client and nothing else, that no `:mutate` / `campaignBudgets` /
`adGroupCriteria` reference appears, that the route exposes only `POST`, that
cron auth runs **before** the Google Ads call, and that no secret name appears in
either file. It strips comments first, so prose about `adsMutate` can neither
satisfy nor trip the check. Date-window behavior is covered with fixed clocks
including a month boundary, a cross-midnight timezone case, and an invalid
timezone.

### Not verified — and this is the gap

**The live acceptance test in the handoff (steps 3–12) has not been run.** It
cannot be run from this session: there are no Google Ads credentials here, so no
call has ever been made to the Google Ads API against the Boltz account. Nothing
below has been demonstrated end to end:

- that real Search Terms and Keywords come back,
- that campaign/ad-group names and all metrics are populated,
- that totals reconcile against the Google Ads UI,
- that the API version (`v22`, set in `client.server.ts`) is still current and
  that every selected field is valid for this account's campaign types.

Field selection follows the handoff's specified lists, but **an invalid or
sunset field fails the whole GAQL query at request time**, and only a live call
proves otherwise. Treat section 6 as required, not optional.

---

## 6. What Fendi / Grok needs to do next

1. **Confirm the three inventory inferences in Lovable** (I had no live access):
   Edge Functions list is empty of anything Ads-related; no Lovable scheduled job
   already pulls Ads data; `GOOGLE_ADS_*` secrets are present in Lovable Cloud
   secrets. `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is only needed if the account sits
   under a manager account.
2. **Redeploy.** Per the chain of command: this is a code change on `main`, so it
   needs Lovable **Publish**. No SQL and no migration is involved, so there is
   nothing to run in the Lovable SQL editor. No Edge Functions were added or
   changed, so there is **no edge redeploy** for this change.
3. **Run the real acceptance test** — log out of Google Ads, close Chrome, then:

   ```bash
   curl -X POST "$PUBLIC_APP_URL/api/public/cron/ads-weekly" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   Check: rows present in both lists; `period.start`/`end`/`time_zone` correct;
   campaign and ad-group names populated; impressions/clicks/cost/conversions/
   match type present; no token or secret in the body; nothing secret in logs.
   If it returns `500`, read `detail` — a bad field name or a sunset API version
   shows up there, redacted.
4. **Reconcile one week manually** against the Ads UI, keeping in mind the
   documented, expected differences: summary totals are keyword-attributed
   (`keyword_view`), Performance Max search themes are excluded, and the window
   ends yesterday in the account time zone.
5. **Wire the Monday trigger** the same way the existing three cron endpoints are
   scheduled (that config lives outside this repo). Until then the endpoint is
   agent-callable but not automatic.

## Follow-on work deliberately left out of V1

Not built, because V1 is read-only and nothing downstream needs them yet: no
snapshot/history table (each call is live, so week-over-week comparison isn't
possible yet), no Performance Max search-term report, and no negative-keyword
recommendations. All three are additive on top of this path.
