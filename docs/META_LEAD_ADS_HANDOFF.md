# Meta (Facebook / Instagram) Lead Ads → Boltz — implementation handoff

Boltz Insight Engine is the source of truth for Instant Form leads. Everything runs
as app server routes deployed with the Lovable app. There is no Supabase Edge
Function, Zapier, Make or other middleware.

**Status:** code complete and verified locally against real PostgreSQL (see
[Evidence](#evidence)). **Not yet verified live.** Live success requires a real
or Lead Ads Testing Tool lead visible in the deployed app, which needs the
manual steps below.

## Flow

```
Meta Page leadgen ──POST──▶ /api/public/meta/webhook
                              1. verify X-Hub-Signature-256 (raw body, META_APP_SECRET)
                              2. durable receipt row in meta_lead_submissions (dedupe on meta_lead_id)
                              3. Graph GET /{leadgen_id}  +  GET /{form_id} (consent wording)
                              4. normalize → leads (+ SMS thread when a phone exists)
                              5. mark ingested → enqueue process_meta_lead job
                              6. 200 to Meta (also 200 when step 3 failed: receipt is durable)

pg_cron every 10 min ──▶ /api/public/cron/reconcile-meta-leads?window=incremental   (2 h lookback)
pg_cron nightly      ──▶ /api/public/cron/reconcile-meta-leads?window=nightly       (7 day lookback)
                              list forms → list leads since T → ingest any not in Boltz
                              + retry receipts whose Graph fetch failed

pg_cron every minute ──▶ /api/public/cron/process-jobs   (existing)
                              process_meta_lead → Grok first-touch decision
```

- **Ingestion never depends on xAI.** It runs inline (webhook), from
  reconciliation, or by manual import. The failed-receipt retry path is
  reconciliation, not the job queue, so a paused Grok circuit cannot stall leads.
- **Grok runs only after durable ingestion.** `process_meta_lead` is enqueued
  after the submission row is claimed as `ingested`. It is keyed
  `meta:<leadgen_id>` on the existing `message_jobs` unique index.
- **Deduplication** uses `meta_lead_submissions.meta_lead_id UNIQUE`. The receipt
  insert is `ON CONFLICT DO NOTHING` and the "ingested" update is conditional,
  so webhook replays, webhook+reconciliation races and manual re-imports are
  no-ops. Boltz lead matching is by phone (the existing `leads_phone_e164_unique`),
  then by email. A Meta submission from someone who already texted attaches to
  their existing lead and thread.
- **Ingestion method** (`WEBHOOK` / `RECONCILIATION` / `MANUAL_IMPORT`) records
  the path that *first discovered* the lead. A `WEBHOOK` row whose Graph fetch
  failed and was later completed by reconciliation stays `WEBHOOK`, with the
  retry in `attempts` / the `meta_lead_ingested` event.

## Consent and outbound (communications.send is not bypassed)

- Consent evidence is always stored: form id and name, privacy policy URL,
  disclaimer title, every checkbox with its text and the lead's response. It
  goes to `meta_lead_submissions.consent_evidence`. The disclaimer text goes to
  `consent_text`, and `consent_version = form:<form_id>:sha256:<16 hex>` of that text.
- `leads.consent_status` becomes `opted_in` (basis `web_form`) **only** when the
  form had a custom-disclaimer checkbox about texts/SMS **and** the lead checked
  it. It never overrides `opted_out`.
- Grok's first touch is a **draft by default**. It is recorded in `agent_runs`
  (`prompt_version = boltz-meta-first-touch-v1`, `raw_decision.draft_text`) plus
  a `first_touch_draft_ready` event. Staff see it in the Lead Inbox, click
  "Use draft", and send through the existing `sendOwnerMessage` →
  `requireCapability("communications.send")` path.
- Automatic first-touch SMS happens only when **both** are true:
  `META_AUTO_FIRST_TOUCH=enabled` **and** the lead is `opted_in` from the form's
  SMS checkbox. It then goes through the single `sendOutbound` path (policy
  validation, RingCentral capability check, idempotency key
  `meta-first-touch:<leadgen_id>`).
- First touch is skipped (with an audit event) when: there is no usable phone,
  the lead is opted out, the lead already has an SMS conversation, or the
  thread is under human control. Deterministic safety rules
  (`detectEscalation`) run on the form text before Grok.

## Schema — `supabase/migrations/20260924180000_meta_lead_ads_ingestion.sql`

Apply in the **Lovable SQL editor**. The migration is idempotent and safe to re-run.

- enum `lead_ingestion_method` (`WEBHOOK`, `RECONCILIATION`, `MANUAL_IMPORT`)
- enum `meta_ingest_status` (`received`, `ingested`, `failed`)
- `message_job_type` + `process_meta_lead`
- table `meta_lead_submissions`: `meta_lead_id` (unique), `lead_id` → `leads`
  (`ON DELETE SET NULL`, so the Meta record survives), `ingestion_method`,
  `ingest_status`, `platform` (`facebook`/`instagram`), `is_organic`,
  `page_id`, `form_id`, `form_name`, `ad_id`, `ad_name`, `adset_id`,
  `adset_name`, `campaign_id`, `campaign_name`, `created_time`,
  `raw_field_data` (verbatim Graph `field_data`), `normalized_fields`,
  `consent_evidence`, `consent_text`, `consent_version`, `webhook_payload`,
  `webhook_received_at`, `graph_fetched_at`, `ingested_at`,
  `grok_enqueued_at`, `attempts`, `last_error`
- RLS on; staff `SELECT` only; writes are service-role only; `anon` revoked

The existing `leads` table is unchanged. New leads get
`lead_source = 'Facebook Lead Ads' | 'Instagram Lead Ads'`. The full submission
is appended to `notes` under a `[meta:<id>]` marker. Mapped fields
(name/email/vehicle/mileage/VIN/symptoms) only fill blanks.

## Routes

| Path | Kind | Auth |
| --- | --- | --- |
| `GET /api/public/meta/webhook` | Meta verification handshake | `hub.verify_token` = `META_WEBHOOK_VERIFY_TOKEN` (403 on mismatch) |
| `POST /api/public/meta/webhook` | `leadgen` events | `X-Hub-Signature-256` HMAC of raw body with `META_APP_SECRET` (401 on mismatch, 503 unconfigured) |
| `POST /api/public/cron/reconcile-meta-leads?window=incremental\|nightly[&minutes=N]` | reconciliation | `Authorization: Bearer CRON_SECRET` |

Server functions (owner, `integrations.manage`), in `src/lib/meta-leads.functions.ts`:
`getMetaHealthFn`, `reconcileMetaNow`, `importMetaLead` (MANUAL_IMPORT by lead id), `subscribeMetaPage`.

UI:
- `/integration-health` → **Meta Lead Ads** panel. It shows secrets, webhook
  status and callback URL, last webhook, Page subscription (live check),
  token health (live `debug_token`: validity, expiry, missing scopes), last
  Graph success and failure, last incremental and nightly reconciliation,
  missing-lead count, last Meta lead, totals by ingestion method, and recent
  submissions. Buttons: Reconcile now (2 h), Reconcile 7 days, Manual import,
  Subscribe Page to leadgen.
- `/leads` → source filter (All / Facebook + Instagram / Facebook /
  Instagram), a platform badge per lead, a Meta attribution block in the
  thread (form, campaign, ad, consent version), and the Grok first-touch draft
  with "Use draft". Never-messaged leads (new form submissions) now sort first.

## Secrets (Lovable Cloud server-side secrets — never in chat, never `VITE_`)

| Name | Required | Value |
| --- | --- | --- |
| `META_APP_ID` | yes | App Dashboard → App settings → Basic |
| `META_APP_SECRET` | yes | same page → App secret |
| `META_PAGE_ID` | yes | Boltz Facebook Page id |
| `META_PAGE_ACCESS_TOKEN` | yes | long-lived Page token (see step 3 below) |
| `META_WEBHOOK_VERIFY_TOKEN` | yes | any long random string you choose; entered in both Lovable and the Meta webhook config |
| `META_GRAPH_API_VERSION` | no | default `v24.0`; set e.g. `v25.0` when Meta sunsets it |
| `META_AUTO_FIRST_TOUCH` | no | `enabled` to allow consented auto first-touch SMS; anything else = draft only |

Existing `CRON_SECRET` and `PUBLIC_APP_URL` are reused.

## Deploy order

1. Merge to `main` (Lovable syncs).
2. **Lovable SQL editor:** run `20260924180000_meta_lead_ads_ingestion.sql`.
3. **Lovable Cloud secrets:** add the `META_*` values.
4. **Lovable Publish.** These are app server routes, not Edge Functions, so there is no edge redeploy.
5. **Lovable SQL editor:** schedule reconciliation (replace the placeholders; the
   same pattern as the existing lead-inbox crons):

```sql
select cron.schedule('meta-leads-reconcile-incremental', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://boltz-insight-engine.lovable.app/api/public/cron/reconcile-meta-leads?window=incremental',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);

-- 03:15 America/Chicago (CDT = UTC-5). Adjust to '15 9 * * *' after DST ends if you want it at 03:15 CST.
select cron.schedule('meta-leads-reconcile-nightly', '15 8 * * *', $$
  select net.http_post(
    url := 'https://boltz-insight-engine.lovable.app/api/public/cron/reconcile-meta-leads?window=nightly',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);
```

## Meta App configuration (Fendi, manual)

1. **App.** In developers.facebook.com, use a Business-type app owned by the
   same Business portfolio as the Boltz Page and ad account. Copy App ID and
   App secret into Lovable secrets.
2. **Webhooks product.** Add *Webhooks* → object **Page** → *Subscribe to this object*:
   - Callback URL: `https://boltz-insight-engine.lovable.app/api/public/meta/webhook`
   - Verify token: the exact `META_WEBHOOK_VERIFY_TOKEN` value
   - Click *Verify and save* (this calls our GET handshake), then subscribe the field **`leadgen`**.
3. **Page access token.** In Business settings → Users → **System users**,
   create an admin system user. Assign it the Boltz **Page** (full control) and
   the **app**. *Generate token* for the app with `leads_retrieval`,
   `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_ads` (add `ads_read` if you want ad, ad set and campaign
   *names*; ids come through without it). Then, in Graph API Explorer with that
   token, run `GET /{page-id}?fields=access_token`. That Page token is
   `META_PAGE_ACCESS_TOKEN` (a system-user-derived Page token does not expire).
4. **Leads Access.** In Business settings → Integrations → **Leads Access**,
   open the Page and make sure the app (CRM) is allowed. If Leads Access
   Manager is on and the app isn't listed, Graph returns a permission error
   and `/integration-health` shows a Graph failure.
5. **App mode.** Switch the app to **Live**. In Development mode, Meta only
   delivers leadgen webhooks for leads created by people with a role on the
   app. Standard Access to `leads_retrieval` is normally enough when app, Page
   and ad account share one Business portfolio. If the App Dashboard asks for
   Advanced Access or Business Verification, complete it there.
6. **Subscribe the Page.** In `/integration-health` → Meta panel, click
   *Subscribe Page to leadgen*. Or call `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`
   with the Page token. The panel should then show **subscribed**.
7. **Optional, for auto first touch.** In each Instant Form, add a *Custom
   disclaimer* with an **optional** checkbox whose text is about texts/SMS
   (e.g. "Yes, text me about my estimate…"). Only leads who check it can be
   auto-texted, and only with `META_AUTO_FIRST_TOUCH=enabled`.

## End-to-end test with Meta's Lead Ads Testing Tool

Before you start, `/integration-health` → Meta panel should show all required
secrets Configured, Webhook Configured, Page subscription **subscribed**, and
Token **valid** with no missing scopes.

1. Open <https://developers.facebook.com/tools/lead-ads-testing>, pick the
   Boltz Page and an Instant Form. If a test lead already exists for your user
   and form, click **Delete lead** first (one test lead per user per form).
2. Click **Create lead**, then **Track status**. The delivery for our app
   should show **200** with a JSON body like
   `{"received":1,"ingested":1,"duplicates":0,"failed":0}`.
3. In `/integration-health` → Meta panel, *Last webhook* updates, and the
   recent table shows the lead id as `WEBHOOK · ingested` with form name and
   platform.
4. In `/leads` → filter **Facebook** (or Instagram), the lead appears at the
   top. Open it: the Meta attribution block shows the lead id, form and
   `WEBHOOK`. The audit trail shows `lead_created` and `meta_lead_ingested`.
   Within about a minute (process-jobs cron) it also shows
   `first_touch_draft_ready`, and the Grok draft box appears. **Do not send**
   unless you want a real text to go out.
5. **Dedupe:** click **Reconcile now (2h)**. Expect `scanned ≥1, missing 0,
   ingested 0, duplicates 0`. Paste the lead id into **Manual import**: expect
   `Import: duplicate`. There is still exactly one row for the lead.
6. **Reconciliation backstop:** in App Dashboard → Webhooks → Page,
   **unsubscribe** the `leadgen` field. In the Testing Tool, delete and create
   a new test lead, and confirm *Last webhook* did not change. Click
   **Reconcile now (2h)**: expect `missing 1, ingested 1`, and the new row
   shows `RECONCILIATION · ingested`. Re-subscribe `leadgen` afterwards.
7. SQL evidence (Lovable SQL editor):

```sql
select meta_lead_id, ingestion_method, ingest_status, platform, form_name, created_time, ingested_at, lead_id
from meta_lead_submissions order by created_at desc limit 10;

select meta_lead_id, count(*) from meta_lead_submissions group by 1 having count(*) > 1;  -- expect 0 rows

select job_type, status, inbound_provider_message_id from message_jobs
where job_type = 'process_meta_lead' order by created_at desc limit 10;

select check_name, ok, detail, created_at from integration_health_snapshots
where provider = 'meta' order by created_at desc limit 20;
```

Testing Tool leads are organic test leads, so `ad_id` / `campaign_id` are empty.
Real paid leads fill them.

## Tests

- `npm test` adds `src/server/meta-leads/signature.test.ts` (HMAC, tamper,
  wrong secret, re-serialization, handshake), `normalize.test.ts` (batched
  webhook parsing, field mapping, phone/email validation, SMS consent rules,
  fill-blanks-only) and `meta-gates.test.ts` (signature before parse/persist,
  receipt before Graph, Grok enqueued only after the ingested claim, cron
  auth first, `integrations.manage` on every Meta server fn, no sends outside
  `sendOutbound`, auto first touch behind switch + consent, migration RLS and
  grants).
- `npm run test:migrations` applies the migration on real PostgreSQL. It
  asserts one row per `meta_lead_id` across webhook, replay and
  reconciliation inserts; first ingestion method preserved; duplicate
  `process_meta_lead` jobs rejected; platform check; Meta record survives lead
  deletion; anon can't read; authenticated can't write; RLS on; re-apply is
  idempotent.
- `baseline-migration.test.ts`: the enum parity check now also accepts values
  added by checked-in `ALTER TYPE … ADD VALUE` migrations, since the
  production export predates `process_meta_lead`.

## Evidence

Local run on 2026-09-24. The real route handlers and server modules ran against
PostgreSQL 16 with every repo migration, through PostgREST and `supabase-js`.
Only `graph.facebook.com`, `api.x.ai` and RingCentral HTTP were stubbed. This
proves the code paths, **not** the live Meta connection.

| Scenario | Result |
| --- | --- |
| Handshake, right / wrong verify token | 200 echoes challenge / 403 |
| Unsigned, wrong-secret, tampered body | 401, 401, 401; 0 rows written |
| Signed webhook | 200 `{"received":1,"ingested":1}`; row `WEBHOOK/ingested/facebook` with page/form/ad/adset/campaign ids and names, `created_time`, `consent_version form:F1:sha256:…`; lead `Facebook Lead Ads`, 2014 Honda Accord EX, 142000 mi, symptoms mapped; 6 raw fields preserved |
| Grok after ingestion | `process_meta_lead` succeeded → `agent_runs` `boltz-meta-first-touch-v1`; event `first_touch_draft_ready (auto_first_touch_disabled)`; 0 SMS sent |
| Same webhook replayed ×2 | 200 `duplicates:1` each; still 1 row, 1 lead, 1 job, 1 agent run, 1 `meta_lead_ingested` event, 1 xAI call |
| Webhook during Graph 500 | 200 to Meta; row `WEBHOOK/failed attempts=1` |
| Reconciliation #1 (bad bearer → 401) | `scanned 5, missingDetected 3, notIngested 1, ingested 4, duplicates 0`; the failed webhook row completed (still `WEBHOOK`); Instagram lead `RECONCILIATION`; a submission matching an existing SMS lead attached to it (1 lead, source kept `RingCentral SMS`) |
| Reconciliation #2 + nightly | `missingDetected 0, ingested 0`; 5 rows / 5 distinct ids; 5 jobs / 5 distinct keys |
| Manual import of an existing / new id | `duplicate` / `ingested` as `MANUAL_IMPORT` |
| Auto first touch on, consented vs not | 1 SMS to the consented lead (key `meta-first-touch:<id>`); the other `first_touch_draft_ready (no_sms_consent)` |
| Skips | email-only lead: "No usable phone number"; existing SMS lead: "already has an SMS conversation" |
| Inbox filter query (`meta_lead_submissions!inner`) | Instagram → 2 leads, Facebook → 6 (including the SMS-first lead) |
| Health | subscribed, token valid, last webhook / Graph success + failure / incremental + nightly reconciliation set, missing 0, totals WEBHOOK 4 · RECONCILIATION 3 · MANUAL 1 |

## Known limits

- Email-only Meta leads (no usable phone) get a lead row and appear in the
  list, but the inbox thread panel needs an SMS thread. Their attribution is
  visible in `/integration-health` and in SQL.
- First-touch lifecycle proposals from Grok are recorded in `agent_runs` but
  not applied automatically.
- Per run, reconciliation ingests at most 100 leads (10 pages × 100 per form).
  `truncated: true` in the summary means you should run it again.
- The default Graph version (`v24.0`) is a pin. Set `META_GRAPH_API_VERSION`
  when Meta deprecates it.
