# Directive — schedule Meta reconciliation and prove the lead pipeline

**For:** a Claude agent with browser access to Lovable (this project's SQL
editor) and Meta's Lead Ads Testing Tool, signed in as Fendi.
**Date:** 2026-09-29. **Scope:** two tasks. Do not expand it.

## Operating mode

- Execute both tasks yourself, end to end. No check-ins, no progress updates.
- Exhaust the listed options before stopping.
- Report once at the end, in the format at the bottom.

## Verified state — do not re-diagnose

- Meta app **Boltz Insight Engine** (`2854559924918431`) is **Live**.
- Page `433712466491882` is subscribed to the app for `leadgen`: `GET subscribed_apps` lists the app with `["leadgen"]`.
- Lead form `8699823816745837` is ACTIVE. Reading it with Fendi's user token works.
- The webhook route and code have been live since the 2026-09-25 publish, and all Meta secrets are stored in Lovable.
- The Meta lead table has 0 rows, and the health log has 0 Meta entries.
- `cron.job` holds only the three RingCentral jobs. The Meta reconcile jobs were never scheduled.
- **Open question this directive answers:** can the Engine's *stored* credential (`META_PAGE_ACCESS_TOKEN`) read leads? The earlier success used Fendi's user token, not the Engine's.

## Hard rules

- SQL only in **Lovable → Cloud → SQL editor**. Never a standalone Supabase console or CLI.
- Do not change the Meta app's mode, permissions, products, webhooks or App Review state.
- Do not touch Business settings, Page settings or asset assignments.
- Do not modify or delete the three RingCentral cron jobs.
- No tokens, secrets or lead PII in chat, docs or the report. Report counts, IDs and error codes only.
- Do not press **Send** in the Lead Inbox.

## Task 1 — Schedule the two Meta reconcile jobs

Run once in the Lovable SQL editor. The block copies the existing
reconcile-messages job's command, which includes its URL, headers and bearer,
and swaps only the path. You never see the bearer. It **raises an error
instead of silently doing nothing** if that job isn't found. Re-running it is
safe, because the same job name updates in place.

```sql
do $$
declare src text;
begin
  select command into src
  from cron.job
  where command like '%/api/public/cron/reconcile-messages%'
  order by jobid
  limit 1;
  if src is null then
    raise exception 'no existing cron job calls /api/public/cron/reconcile-messages';
  end if;
  perform cron.schedule('meta-leads-reconcile-incremental', '*/10 * * * *',
    replace(src, '/api/public/cron/reconcile-messages',
                 '/api/public/cron/reconcile-meta-leads?window=incremental'));
  perform cron.schedule('meta-leads-reconcile-nightly', '15 8 * * *',
    replace(src, '/api/public/cron/reconcile-messages',
                 '/api/public/cron/reconcile-meta-leads?window=nightly'));
end $$;

select jobname, schedule, active from cron.job
where jobname like 'meta-leads-reconcile-%';
```

Pass: both jobs are listed and `active = true`.

If it raises `no existing cron job calls …`:
- Run `select jobname, schedule from cron.job;`.
- Find the RingCentral reconcile job by name. The original docs call it
  `lead-inbox-reconcile`.
- Re-run the block, changing only the `where` clause to `where jobname = '<that name>'`.
- If the job's command doesn't contain `/api/public/cron/reconcile-messages`,
  report its jobname and schedule, not its command, and stop.

## Task 2 — Prove it end to end

You don't need an owner sign-in to read the results. The scheduled job
writes its outcome, including Meta's exact error, to `integration_health_snapshots`.

1. **Wait for the first scheduled run** (the next :00/:10/:20… mark, plus a
   minute), then run:
   ```sql
   select check_name, ok, detail, created_at
   from integration_health_snapshots
   where provider = 'meta'
   order by created_at desc limit 10;

   select status_code, created
   from net._http_response
   order by created desc limit 5;
   ```
   - If the snapshots show `reconcile_incremental` with `ok = true`, the stored
     credential works. Go to step 2.
   - If `ok = false`, the `detail` is the exact error. Use the table below.
   - If there are no Meta snapshots at all and `net._http_response` shows 401
     or 503, the job reached the route but was rejected. **401**: the copied
     bearer doesn't match `CRON_SECRET`. **503**: the server says Meta config
     is missing. Report the status code.

2. **Send a test lead.**
   - Open `https://developers.facebook.com/tools/lead-ads-testing`.
   - Choose Page `433712466491882` and form `8699823816745837`.
   - If a test lead exists for your user, **Delete lead** first. Then
     **Create lead** → **Track status**, and record the delivery status code
     Meta shows for our callback.

3. **Confirm it landed.** Within about 10 minutes, run:
   ```sql
   select meta_lead_id, ingestion_method, ingest_status, platform, created_time, ingested_at
   from meta_lead_submissions order by created_at desc limit 5;
   ```
   - **Pass (webhook):** the row shows `WEBHOOK · ingested`.
   - **Pass (reconciliation only):** the row shows `RECONCILIATION · ingested`.
     The pipeline works, but Meta's webhook delivery didn't reach us. Record
     the Testing Tool's delivery status code and error text.
   - **No row:** re-run the step 1 snapshot query and use its `detail`.

### Interpreting a failed `reconcile_incremental` / `graph_fetch` / `token_auth` detail

| `detail` contains | Meaning | Action |
| --- | --- | --- |
| `(#190)`, `Error validating access token`, `Session has expired` | The stored Page token is invalid or expired | **Fix it, then retry** (below) |
| `This method must be called with a Page Access Token` | The stored value is a User or System-user token, not a Page token | **Fix it, then retry** (below) |
| `(#10)`, `(#200)`, `permission`, `leads access`, `insufficient privileges` | The credential is valid but not allowed to read leads | Report the exact code and message, then stop |
| `Missing server secret: …` | A secret isn't visible to the running app | Re-enter that secret in Lovable Cloud secrets, Publish, wait for the next run |
| anything else | — | Report it verbatim, then stop |

**Fix the stored Page token** (touches only the Lovable secret):

1. Open Graph API Explorer and select app `2854559924918431`. Generate a
   *User token* for Fendi with `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `leads_retrieval`, `pages_manage_ads`,
   `ads_management` and `business_management`.
2. Open the **Access Token Debugger** and click **Extend Access Token**. This
   gives a long-lived user token.
3. Back in Explorer, with the long-lived user token, run
   `GET /433712466491882?fields=access_token`. The returned `access_token` is
   a Page token that doesn't expire.
4. Check it in the Debugger: **Type Page**, Page ID `433712466491882`,
   **Expires Never**.
5. Paste it directly into the Lovable secret `META_PAGE_ACCESS_TOKEN`,
   **Publish**, then wait for the next scheduled run and re-check step 1.

## Report back (once)

1. **Jobs:** the `jobname` and `schedule` of both Meta jobs as shown in
   `cron.job`, and whether they're active.
2. **Test lead:** did it land? Give yes or no, the `ingestion_method`, and
   the `ingested_at` timestamp.
3. **Failure, if any:** the exact `detail`, or the HTTP status code, and
   which fix you tried. No re-architecture and no new diagnoses.
