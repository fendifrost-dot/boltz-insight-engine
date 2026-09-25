# Directive — take Boltz Meta Lead Ads live (browser agent, autonomous)

**For:** a Claude agent with browser access, signed in as Fendi on Meta
(developers.facebook.com, business.facebook.com), Lovable, and
`https://boltz-insight-engine.lovable.app`.
**Code state:** PRs #23 and #24 are merged to `main`. #24 fixed the Meta
health panel: it now names each failing check with its real error, and its
action buttons work even when a check fails. You are not writing code.

## Operating mode — read first

- **Execute the whole directive yourself, start to finish.** Do not check in,
  ask for confirmation, send progress updates, or report success.
- **Exhaust every option before you stop.** When something fails:
  1. Read the exact error.
  2. Use the fix table below.
  3. Retry after each fix.
  4. Try the listed fallback.
  5. Search Meta's help or UI for the named setting.
  6. Try again after a Publish.

  Only when all of that fails **and** it meets the Code Red definition do you report.
- **Report back only for a CODE RED.** No green reports, no yellow reports, no
  "FYI", no "should I…?" questions. If it isn't Code Red, decide and continue.
- On success, you record evidence in the database (step 10) and **send
  nothing**.

### CODE RED — the only reasons to report

Report only if one of these holds after you've exhausted the options:

1. **Someone else must act.** Meta requires something only a person can
   supply: identity documents, Business Verification, an App Review
   submission, payment or billing details, or an action by another
   portfolio's owner (Reverse Engineers Media / Des Murray).
2. **The app's code is wrong.** The code in `main` returns wrong or broken
   behavior that no configuration change fixes: a stack trace, a
   deterministic 500 from a Boltz route, or data written wrongly. Include the
   exact error and the request that produced it.
3. **A hard rule was broken or is about to be.** For example, a real SMS
   went out, a secret was exposed, ad delivery or budget changed, or data
   was lost.
4. **Lovable is losing the deployment.** The billing "payment issue"
   escalates to a downgrade, or the deployment is lost.

A Code Red report is **one message**:
- `CODE RED:` and a one-line cause
- the step number
- the exact error text
- everything you tried
- the single action needed from Fendi

**Never** include a token, secret, verify token or bearer value.

## Hard rules (never break these)

- Secrets go from Meta straight into Lovable Cloud secrets. Never put them in
  chat, docs, screenshots, SQL output you copy, or reports.
- No standalone Supabase and no Supabase CLI. SQL runs **only** in the
  Lovable SQL editor of this project.
- Do not create, edit, pause or publish ads, campaigns, ad sets, budgets,
  audiences or billing.
- Do not set `META_AUTO_FIRST_TOUCH`.
- Do not press **Send** in the Lead Inbox. No SMS may go out.
- Do not change RingCentral settings or the existing `lead-inbox-*` cron jobs.

## Known state (verified 2026-09-25 — don't redo)

- **App:** *Boltz Insight Engine*, App ID `2854559924918431`, type Business,
  portfolio Boltz Automotive Inc. Products: Webhooks and Marketing API.
- **Permissions:** eight at Standard access — `leads_retrieval`,
  `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`,
  `pages_manage_ads`, `ads_management`, `ads_read`, `business_management`.
- **Privacy policy:** `https://boltzautogarage.com/privacy-policy`.
- **Webhook:** the Page object webhook handshake passed; `leadgen` is
  subscribed on v26.0.
- **System user:** `boltzinsightengine`. It and Fendi have full access on
  Page **Boltz Automotive** `433712466491882`.
- **Lovable:** all Meta secrets are stored; the migration is applied
  (`meta_lead_submissions` exists).
- **Graph:** lead retrieval works (test lead `2283654155812202`, form `8699823816745837`).

## Steps

### 1. Deploy the fix
In Lovable, **Publish** (PR #24 is merged to `main`). Wait until the publish
completes, then hard-reload `https://boltz-insight-engine.lovable.app/integration-health`.

### 2. Clear every failed health check
In the **Meta Lead Ads** panel, click **Re-check**. The panel now lists each
failed check with its real message. Fix every one using this table, then
Re-check until the panel shows no failed checks, the Token reads **valid**,
and no scopes are missing.

| Message contains | Fix |
| --- | --- |
| `Missing server secret: X` / required secret shows *Missing* | Re-enter X in Lovable Cloud secrets, Publish, then Re-check |
| `(#190)`, `Session has expired`, `Error validating access token`, Token **invalid** | Regenerate the Page token: system user → Generate token (app 2854559924918431, all eight permissions, expiry *Never*) → Graph API Explorer `GET /433712466491882?fields=access_token` → paste into `META_PAGE_ACCESS_TOKEN` → Publish → Re-check. Confirm in the Access Token Debugger: Type **Page**, Expires **Never**. |
| `Missing scopes: …` | Regenerate the system-user token with the missing scopes ticked, then derive the Page token again (row above) |
| `(#10)` / `insufficient privileges` | Page → People: make sure Fendi and the system user have full control of the Page, then regenerate the token |
| `(#200)` / `requires … permission` | App Review → Permissions: confirm the named permission shows *Standard access / Ready to use*; regenerate the token with it ticked |
| `permission denied for table …` / `relation … does not exist` | Lovable SQL editor: re-run `supabase/migrations/20260924180000_meta_lead_ads_ingestion.sql` from `main` (it is idempotent), then Re-check |
| `Missing Supabase environment variable(s)` | Code Red #2 (a platform secret the app itself needs is missing) |
| The panel itself says *Meta health check failed* with a message | Apply the matching row above. If nothing matches, Publish again and Re-check once. If it's still failing, it's Code Red #2 with the message |

### 3. Subscribe the Page to the app
Click **Subscribe Page to leadgen** in the panel. Re-check. **Page
subscription** must read *subscribed*.

- **Fallback:** in Graph API Explorer, with the **Page** token, run
  `POST /433712466491882/subscribed_apps?subscribed_fields=leadgen`. It
  should return `{"success": true}`. Then Re-check.
- If both fail, fix the error they return using the step 2 table and retry.

### 4. Remove the stray User-object webhook
App Dashboard → Webhooks → object **User**: delete the subscription that
points at `/api/public/meta/webhook`, or unsubscribe all its fields. The
**Page** object and its `leadgen` subscription stay exactly as they are.

### 5. Webhook end-to-end with a test lead
1. Open `https://developers.facebook.com/tools/lead-ads-testing`.
2. Page **Boltz Automotive**, form `8699823816745837`.
3. If a test lead exists for you, **Delete lead**. Then **Create lead** →
   **Track status**.

Pass when all of these hold:
- The delivery to our callback shows **200** with a body like `{"received":1,"ingested":1,…}`.
- Re-check shows *Last webhook* updated, and the recent table shows the lead id as **WEBHOOK · ingested**.
- `/leads` → filter **Facebook**: the lead is listed with a *Facebook lead*
  badge. Opening it shows the Meta Lead Ads block. Don't click Send.
- In the Lovable SQL editor:
  ```sql
  select meta_lead_id, ingestion_method, ingest_status, platform, form_name, lead_id
  from meta_lead_submissions order by created_at desc limit 5;
  ```

If it doesn't pass, work through the failures:

| Symptom | Fix |
| --- | --- |
| Delivery **401** | `META_APP_SECRET` doesn't belong to app 2854559924918431. Re-copy it from App settings → Basic, Publish, create a new test lead. |
| Delivery **503** | A webhook secret is missing on the deployed app. Re-enter it, Publish, retry. |
| No delivery at all | Check three things, then retry: (a) Page object `leadgen` is subscribed; (b) step 3 shows *subscribed*; (c) you (Fendi) hold an app role (Admin / Developer / Tester), since Development mode only delivers to people with a role. |
| **200** but the row says `failed` | Read `last_error` in the recent table and fix it with the step 2 table. Then click **Reconcile now (2h)**; the row must turn *ingested*. |
| Still no webhook after all of the above | Click **Reconcile now (2h)**. If the lead ingests as `RECONCILIATION`, the pipeline works and only delivery is broken. Recheck App mode (step 9) and the Page subscription, then repeat with a fresh test lead. After step 9, a Live-mode test must pass by webhook. |

### 6. Dedupe check
- Click **Reconcile now (2h)**. Expect `missing 0, ingested 0`.
- Paste the step 5 lead id into **Manual import**. Expect `Import: duplicate`.
- In the SQL editor, this must return **0 rows**:
  ```sql
  select meta_lead_id, count(*) from meta_lead_submissions group by 1 having count(*) > 1;
  ```

### 7. Reconciliation backstop
1. App Dashboard → Webhooks → Page → **unsubscribe** `leadgen`.
2. Delete and create a new test lead, then Re-check: *Last webhook* must
   **not** change.
3. Click **Reconcile now (2h)**. Expect `missing 1, ingested 1`, and the new
   row shows **RECONCILIATION · ingested**.
4. **Re-subscribe `leadgen`** (v26.0), then Re-check that the Page
   subscription is *subscribed*. Never leave `leadgen` unsubscribed.

### 8. Schedule reconciliation (cron)
In the Lovable SQL editor, run the block below. It copies the existing cron
bearer internally, so you never see or copy it. It's safe to re-run, since
the same job name updates in place.

```sql
do $$
declare bearer text;
begin
  select substring(command from 'Bearer ([^"'' ]+)') into bearer
  from cron.job where jobname like 'lead-inbox-%' and command like '%Bearer %' limit 1;
  if bearer is null then raise exception 'no lead-inbox cron job with a bearer to copy'; end if;
  perform cron.schedule('meta-leads-reconcile-incremental', '*/10 * * * *', format(
    $f$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb);$f$,
    'https://boltz-insight-engine.lovable.app/api/public/cron/reconcile-meta-leads?window=incremental',
    json_build_object('Content-Type','application/json','Authorization','Bearer ' || bearer)::text));
  perform cron.schedule('meta-leads-reconcile-nightly', '15 8 * * *', format(
    $f$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb);$f$,
    'https://boltz-insight-engine.lovable.app/api/public/cron/reconcile-meta-leads?window=nightly',
    json_build_object('Content-Type','application/json','Authorization','Bearer ' || bearer)::text));
end $$;
select jobname, schedule from cron.job where jobname like 'meta-leads-%';
```

If it raises `no lead-inbox cron job with a bearer to copy`:
- Run `select jobname from cron.job;`.
- If any job calls `boltz-insight-engine.lovable.app/api/public/cron/` with a
  Bearer header, change the `where` clause to match that job and re-run.
- Only if no such job exists at all is this Code Red #1: Fendi must supply
  the cron secret in Lovable.

To verify, wait until the next 10-minute mark, then run:
```sql
select status_code, created from net._http_response order by created desc limit 5;
```
A **200** must appear. Re-check must also show *Last reconciliation → incremental* at the new time. On 401, the copied bearer didn't match `CRON_SECRET`: re-run the block, copying from a different `lead-inbox-*` job. On 503, Meta config is missing on the server; fix it with the step 2 table.

### 9. Switch the app to Live
Do this only after step 5 passed. In the App Dashboard, toggle **Live**.

If Meta lists missing items, fill them in and retry:
- **Privacy policy URL:** `https://boltzautogarage.com/privacy-policy`
- **Data deletion instructions URL:** the same URL
- **App icon:** 1024×1024, the Boltz logo from boltzautogarage.com
- **Category:** Business
- **Contact email:** Fendi's

If Meta requires **Business Verification** or **App Review** to go Live,
that's Code Red #1.

After Live, delete and create one more test lead. It must arrive by **webhook** (step 5 pass criteria).

### 10. Record completion (instead of reporting)
In the Lovable SQL editor, record the lead ids. This row is the evidence;
Fendi and Claude Code read it from `/integration-health`.

```sql
insert into integration_health_snapshots (provider, check_name, ok, detail, metadata_redacted)
values ('meta', 'go_live_verification', true,
  'Webhook, dedupe, reconciliation backstop, cron and Live mode verified',
  jsonb_build_object(
    'webhook_lead_id', '<step 5 lead id>',
    'reconciliation_lead_id', '<step 7 lead id>',
    'live_mode_lead_id', '<step 9 lead id>',
    'app_mode', 'Live',
    'cron_jobs', (select jsonb_agg(jobname) from cron.job where jobname like 'meta-leads-%')));
```

Then stop. Send nothing unless something above hit Code Red.

## Not yours — don't act on these
- claiming personal ad account `686411475366536`
- Page ownership transfer
- the Instant Form SMS-consent checkbox, since it needs an ad change
- turning on auto-texting
- Lovable billing, unless it escalates (Code Red #4)
