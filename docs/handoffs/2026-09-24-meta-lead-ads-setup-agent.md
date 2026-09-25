# Handoff — configure Meta for Boltz Lead Ads ingestion (browser agent)

**For:** a Claude agent with browser access, signed in as Fendi (Meta Business
Suite / developers.facebook.com and Lovable).
**Goal:** create or obtain the correct Meta API credentials, configure Meta, and
enter them into Lovable Cloud. The target is a Meta Lead Ads Testing Tool
lead appearing in Boltz Insight Engine.
**Code:** already written. See PR #23 in `fendifrost-dot/boltz-insight-engine`
and `docs/META_LEAD_ADS_HANDOFF.md`. You are not writing code.

---

## Hard rules

- **Never paste a token, app secret or verify token into chat, a doc, a
  commit, a PR or a screenshot description.** Copy each one straight from Meta
  into the Lovable Cloud secret field. When reporting back, say
  "configured (N chars)" and never the value.
- **No standalone Supabase.** Do not open supabase.com and do not run the
  Supabase CLI. SQL runs only in the **Lovable SQL editor** of the Boltz
  project.
- **Do not create, edit, pause or publish ads, campaigns, budgets or billing.**
  Only touch: the app, the Webhooks product, the system user, Page/app asset
  assignments, Leads Access, and Instant Form *consent disclaimer* (optional
  step 9).
- **Do not set `META_AUTO_FIRST_TOUCH`.** Leave auto-texting off. Fendi decides that later.
- **Do not send any SMS** from the Boltz Lead Inbox during testing.
- If Meta demands something that costs money, changes ad delivery, or needs
  identity documents (Business Verification), **stop and report**. Do not
  work around it.
- Meta's UI moves often. If a menu path below is wrong, use the search box in
  Business settings / App Dashboard for the named item. Don't guess at
  unrelated settings.

## Preconditions (verify; do not skip)

1. PR #23 is **merged to `main`**. If not, stop and tell Fendi; he merges it.
2. The Boltz Lovable project is **published** after the merge. In Lovable
   click **Publish**. These are app routes, so no Edge Function redeploy is needed.
3. The migration is applied. In the **Lovable SQL editor** of the Boltz project, run:
   ```sql
   select to_regclass('public.meta_lead_submissions');
   ```
   If it returns `null`, paste and run the full contents of
   `supabase/migrations/20260924180000_meta_lead_ads_ingestion.sql` from the
   `main` branch, then re-run the check. It is idempotent.
4. Open `https://boltz-insight-engine.lovable.app/integration-health`, signed
   in as the owner. The **Meta Lead Ads (Facebook / Instagram)** panel must be
   present, showing required secrets as *Missing*. If the panel is absent,
   the publish did not include PR #23: stop and report.

Record these values as you go. Only the IDs may be written down; secrets go
straight into Lovable.

| Value | Where it goes |
| --- | --- |
| Business portfolio name + ID | report only |
| Boltz Facebook Page ID | Lovable secret `META_PAGE_ID` |
| Connected Instagram account (if any) | report only |
| App ID | Lovable secret `META_APP_ID` |
| App secret | Lovable secret `META_APP_SECRET` (never written down) |
| Page access token | Lovable secret `META_PAGE_ACCESS_TOKEN` (never written down) |
| Webhook verify token | Lovable secret `META_WEBHOOK_VERIFY_TOKEN` (never written down) |

---

## Step 1 — Find the Page and check who can read its leads

**What actually gates lead retrieval is Page task assignment, not portfolio
layout.** Someone has to be assigned to the Page with the **Leads** task
(shown as *Manage leads* / *Leads* / full control). If nobody is, every lead
call fails with `(#10) User has insufficient privileges on the page`, whoever
owns what.

1. Go to **business.facebook.com** → **Settings** (Business settings).
2. Note which Business portfolio owns the **Boltz Facebook Page** and which
   owns the **ad account** running the Lead Ads. Record both in the report.
   **A split across portfolios is not a blocker.** Do not stop for it; carry on.
3. **Accounts → Pages** → select the Boltz Page → copy the **Page ID**.
4. On that Page, open **People** (or *Assigned people*) and check who has the
   **Leads** task.
   - If **Fendi is not assigned with Leads** (or full control), assign him:
     *Assign people* → Fendi → enable the Leads task (full control is
     fine) → save. This is the fix. It does not need another person or
     another portfolio's owner.
   - If you cannot assign people on this Page from this portfolio, stop and
     report exactly what Meta shows. That, not the portfolio split, is a real blocker.
5. **Verify with Graph API Explorer** (User token for Fendi is fine for this check):
   `GET /{PAGE_ID}/leadgen_forms?fields=id,name,status,leads_count`
   - `(#10) User has insufficient privileges on the page` → the Leads task is
     still missing. Go back to 4.
   - `(#190) This method must be called with a Page Access Token` → **pass**.
     Privileges are fine; the call just needs a Page token, which step 4
     produces. See [Verification evidence](#verification-evidence).
6. **Accounts → Instagram accounts**: note whether an Instagram account is
   connected. Instagram lead forms deliver through the same Facebook Page, so
   no extra setup is needed.

## Step 2 — The Meta app (the API "client")

1. Go to **developers.facebook.com → My Apps**.
2. Reuse an existing Boltz Business-type app if one exists. Otherwise **Create app**:
   1. Enter name `Boltz Insight Engine` and Fendi's contact email → **Next**.
   2. On **Add use cases**, set the category filter to **Others**, scroll to
      *Looking for something else?*, choose **Other** → **Next**.
   3. Pick app type **Business** → **Next**. The app type cannot be changed after creation.
   4. On **Details**, confirm name and contact email and select the Business
      portfolio that owns the Page (step 1).
   5. **Create app**.

   The **Other** option now shows a banner, "This option is going away soon",
   and creates the app "in the old experience". It still works, and it is the
   path that was used for Boltz. *Create an app without a use case* is the
   modern alternative. It was not chosen because nobody has verified which
   permissions are available under it.
3. **App settings → Basic**:
   - Copy **App ID** → Lovable secret `META_APP_ID`.
   - Click **Show** on **App secret** → Lovable secret `META_APP_SECRET`.
   - Privacy Policy URL: `https://boltzautogarage.com/privacy-policy`
     (`/privacy` returns 404). Live mode requires it. The page already
     contains the SMS consent and SMS Terms language.
   - Category: Business. Save.
4. Add products: **Webhooks**, and **Marketing API** if the dashboard offers
   it (it enables the ads permissions).

## Step 3 — Permissions and access level ("the correct Meta API")

The Page token this integration uses must carry these permissions:

| Permission | Why |
| --- | --- |
| `leads_retrieval` | read lead form answers (`GET /{leadgen_id}`, `/{form_id}/leads`) |
| `pages_manage_metadata` | subscribe the app to the Page's `leadgen` webhook |
| `pages_show_list` | list/access the Page |
| `pages_read_engagement` | read Page-level objects, forms |
| `pages_manage_ads` | lead forms on the Page |
| `ads_management` | required by Meta for leadgen webhooks on ad leads |
| `ads_read` | optional: ad / ad set / campaign **names** (IDs arrive without it) |
| `business_management` | lets the system user work with the Business assets |

In **App Dashboard → App Review → Permissions and features** (sometimes shown
as *Use cases → Customize*):

1. For each permission above, check its **access level**.
   - **Standard access** is usually enough when only Boltz's own Page is used
     and the token's owner is assigned to that Page with the Leads task (step 1).
   - If `leads_retrieval`, `pages_manage_metadata`, `pages_manage_ads` or
     `ads_management` shows a requirement to get **Advanced access** before
     it works for Live data, **stop and report exactly what Meta asks for**:
     App Review submission, screencast, or Business Verification. Fendi
     decides whether to submit.
2. Do **not** submit App Review on your own.

## Step 4 — System user and a non-expiring Page token

1. **Business settings → Users → System users → Add**. Name
   `boltz-insight-engine`, role **Admin**.
2. With the system user selected, **Assign assets**:
   - **Pages** → Boltz Page → **Full control** (at minimum it must include
     *Advertise / Create ads*, *Manage leads*, and *Manage Page*).
   - **Apps** → the app from step 2 → **Full control / Develop app**.
   - **Ad accounts** → the Boltz ad account → **View performance** (for
     `ads_read` names). Grant nothing more.
3. **Generate new token** for the system user:
   - App: the app from step 2.
   - Token expiration: **Never**.
   - Permissions: every permission in the step 3 table.
   - Copy the token into a **private scratch tab only** (e.g. Graph API
     Explorer's token field). It is a *system-user token*, not yet the Page
     token.
4. Open **developers.facebook.com/tools/explorer** (Graph API Explorer):
   - Application: the app from step 2. Paste the system-user token into the
     Access Token field.
   - Version: **v26.0** (current). Don't choose anything older; v20.0
     stopped working on 24 Sep 2026.
   - Run `GET /{PAGE_ID}?fields=id,name,access_token`.
   - The `access_token` returned is the **Page access token**. Copy it
     directly into the Lovable secret `META_PAGE_ACCESS_TOKEN`.
5. Verify the Page token in **developers.facebook.com/tools/debug/accesstoken**:
   - **Type: Page**, Page ID matches, **Expires: Never**.
   - Scopes include `leads_retrieval`, `pages_manage_metadata`,
     `pages_show_list`, `pages_read_engagement`.
   - If the type is *User* or *System User*, you copied the wrong token. Redo step 4.4.

**Common trap:** a token can subscribe the Page successfully and still fail
to read leads. Reading needs the token's owner to have the leads/advertise
task on the Page, **and** the app to be allowed in Leads Access (step 6).
The Boltz health panel catches this as a Graph failure.

## Step 5 — Lovable Cloud secrets

In the Boltz Lovable project's Cloud **Secrets**, add or update the following.
Paste values directly; never into the chat.

| Secret | Value |
| --- | --- |
| `META_APP_ID` | App ID (step 2) |
| `META_APP_SECRET` | App secret (step 2) |
| `META_PAGE_ID` | Page ID (step 1) |
| `META_PAGE_ACCESS_TOKEN` | Page token (step 4.4) |
| `META_WEBHOOK_VERIFY_TOKEN` | generate a new random string, 32+ chars, letters and digits only; you will paste the same string into Meta in step 7 |
| `META_GRAPH_API_VERSION` | `v26.0` |

Leave `META_AUTO_FIRST_TOUCH` **unset**. `CRON_SECRET` and `PUBLIC_APP_URL`
already exist; don't change them.

After saving the secrets, **Publish** again if Lovable says secrets need a
redeploy. Then reload `/integration-health` → Meta panel: all required
secrets should read *Configured*, and **Token** should read **valid** with no
missing scopes.

## Step 6 — Leads Access (CRM access)

1. Go to **Business settings → Integrations → Leads Access**. It may be
   labelled *Leads Access Manager*, or live under Meta Business Suite → All
   tools → Instant Forms → *CRM setup / Leads access*.
2. Select the Boltz Page.
3. Under **CRMs**, make sure the app from step 2 is **allowed** (Assign /
   Add CRM). Also make sure Fendi's user and the system user are allowed
   under **People** if that list is restricted.

**Partner-shared Page:** if the Page is owned by another portfolio and only
shared into Boltz's, Business settings refuses with *"You cannot create leads
access for pages that are not owned by your business"*. **This does not block
lead retrieval.** For Boltz, assigning Fendi and the system user to the shared
Page (step 1.4, step 4.2) was enough. CRM allowlisting can then only be set up
by the owning portfolio (Reverse Engineers Media). Record the refusal in the
report and carry on.

## Step 7 — Webhook subscription (Meta → Boltz)

1. **App Dashboard → Webhooks** (or Use cases → Customize → Webhooks). In the object dropdown pick **Page**.
   Subscribe **only** the Page object. If the **User** object also has a
   subscription pointing at the Boltz endpoint, remove it. It only sends
   profile-change events, which the handler ignores, and it confuses later debugging.
2. **Subscribe to this object**:
   - Callback URL: `https://boltz-insight-engine.lovable.app/api/public/meta/webhook`
   - Verify token: the exact `META_WEBHOOK_VERIFY_TOKEN` string from step 5
   - **Verify and save**. Meta calls the handshake, and Boltz echoes the
     challenge only when the token matches. If it fails: check that the
     secret was saved, and that the app was published after saving it.
3. In the Page field list, find **`leadgen`** → **Subscribe**. Use the
   current API version (v26.0) if asked.
4. Subscribe the **Page** to the app:
   - Easiest: `/integration-health` → Meta panel → **Subscribe Page to
     leadgen**. The status should turn **subscribed**.
   - Fallback in Graph API Explorer, with the **Page** token:
     `POST /{PAGE_ID}/subscribed_apps?subscribed_fields=leadgen`, which should
     return `{"success": true}`.

## Step 8 — App mode

1. Switch the app to **Live** (toggle at the top of the App Dashboard). This
   needs the privacy policy URL from step 2.
2. Development mode only delivers leadgen webhooks for leads created by
   people with a role on the app. Live mode is needed for real customer leads.
3. If Live is blocked, report the exact blocker text.

## Step 9 — (Optional, only if Fendi wants SMS consent captured) Instant Form disclaimer

**Only if Fendi has said yes.** Otherwise skip and mention it in the report.
Editing a published form may create a new form version, and copying it is safer.

1. Go to Meta Business Suite → **All tools → Instant Forms** → the Boltz form.
2. Add a **Custom disclaimer** with an **optional** checkbox. Its text must
   mention texts/SMS. For example: "Yes, Boltz Auto may text me about my
   repair estimate at the number provided. Msg & data rates may apply. Reply
   STOP to opt out."
3. Do not make the checkbox required.

## Step 10 — End-to-end verification with the Lead Ads Testing Tool

1. `/integration-health` → Meta panel shows:
   - Webhook **Configured**, with the callback URL
   - Page subscription **subscribed**
   - Token **valid**, expires **never**, no missing scopes
2. Open **developers.facebook.com/tools/lead-ads-testing**, then select the
   Boltz Page and a form. If a test lead exists for your user, click **Delete
   lead** first.
3. Click **Create lead** → **Track status**. Boltz's delivery must show **200**
   with a body like `{"received":1,"ingested":1,"duplicates":0,"failed":0}`.
4. `/integration-health` → Meta panel should show:
   - *Last webhook* just updated
   - the recent table shows the lead id as **WEBHOOK · ingested**
   - *Last Graph fetch* just updated
5. `/leads` → source filter **Facebook**: the test lead is listed at the top
   with a *Facebook lead* badge. Open it: the Meta Lead Ads block shows the
   lead id and `WEBHOOK`. Within about a minute the audit trail shows
   `meta_lead_ingested` then `first_touch_draft_ready`. **Do not click Send.**
6. **Dedupe:**
   - Click **Reconcile now (2h)**. Expect `missing 0, ingested 0`.
   - Paste the lead id into **Manual import**. Expect `Import: duplicate`.
7. **Reconciliation backstop:**
   - In App Dashboard → Webhooks → Page, **unsubscribe `leadgen`**.
   - In the Testing Tool, delete and create a new test lead. Confirm *Last
     webhook* did **not** change.
   - Click **Reconcile now (2h)**. Expect `missing 1, ingested 1`, and the
     new row shows **RECONCILIATION · ingested**.
   - **Re-subscribe `leadgen`** and confirm the panel shows subscribed again.
8. **Schedule reconciliation.** In the **Lovable SQL editor**, check first
   whether the jobs exist:
   ```sql
   select jobname, schedule from cron.job where jobname like 'meta-leads-%';
   ```
   If they are missing, run the two `cron.schedule` statements from
   `docs/META_LEAD_ADS_HANDOFF.md` → *Deploy order* step 5. Replace
   `CRON_SECRET` in the header with the real value by reading it from the
   existing `lead-inbox-*` cron jobs' command:
   ```sql
   select jobname, command from cron.job where jobname like 'lead-inbox-%';
   ```
   Never copy that value into chat or the report.
9. Evidence query in the Lovable SQL editor. Paste the result rows into the report; they contain no secrets:
   ```sql
   select meta_lead_id, ingestion_method, ingest_status, platform, form_name, created_time, ingested_at
   from meta_lead_submissions order by created_at desc limit 5;
   select meta_lead_id, count(*) from meta_lead_submissions group by 1 having count(*) > 1;
   ```
   The second query must return **0 rows**.
10. Leave the test leads in place so Fendi can see them. Report their lead ids.

## Verification evidence

The same Graph call on the Boltz Page, before and after assigning Fendi to the
Page with the Leads task. The Page and the ad account were in different
portfolios the whole time; that was never the problem.

```
GET /433712466491882/leadgen_forms?fields=id,name,status,leads_count

before:  (#10) User has insufficient privileges on the page
after:   (#190) This method must be called with a Page Access Token
```

Error 190 is the expected next state, not a failure. Privileges are fine; the
call just needs a Page token rather than a User token (step 4).

## Troubleshooting map

| Symptom in Boltz / Meta | Likely cause | Fix |
| --- | --- | --- |
| Verify and save fails | verify token mismatch, or secrets not live | re-enter the token in both places; Publish; retry |
| Testing Tool delivery 401 | `META_APP_SECRET` is from a different app | re-copy the App secret of the app that owns the webhook |
| Testing Tool delivery 503 | secret missing on the deployed app | add the secret; Publish |
| Graph `(#10) User has insufficient privileges on the page` | nobody (or not the token owner) has the Leads task on the Page | step 1.4: assign the Leads task; re-run step 1.5 |
| Graph `(#190) This method must be called with a Page Access Token` | a User/System-user token was used on a Page endpoint | expected during step 1.5; use the Page token from step 4.4 |
| Delivery 200 but row `failed`; Graph failure "permission" | Leads Access excludes the app, or the token owner lacks the leads/advertise task | step 6; step 4.2 task assignment; regenerate the token |
| Graph failure code 190 / Token invalid | wrong or expired token, or a User token was used | redo step 4.4 and 4.5 |
| No webhook at all, Page shows subscribed | app in Development mode, or `leadgen` field not subscribed on the Page object | step 8; step 7.3 |
| Token shows missing scopes | the system-user token was generated without them | regenerate in step 4.3 with all permissions, then redo 4.4 |

## Report back to Fendi (fill in)

```
Business portfolio(s): Page owned by <name> (<id>); ad account owned by <name> (<id>)   (split is OK)
Page Leads task: assigned to <who>; verification call → #10 / #190 (pass)
Page: <name> (<id>); Instagram connected: <handle or none>
App: <name> (<app id>), mode: Live/Development
Permission access levels: leads_retrieval=<std/adv>, pages_manage_metadata=<>, pages_manage_ads=<>, ads_management=<>, ads_read=<>
App Review / Business Verification required: <no | exactly what Meta asked for>
System user: boltz-insight-engine, assets: Page=<tasks>, App=<role>, Ad account=<role>
Page token: type Page, expires never, scopes OK: yes/no   (value NOT recorded)
Lovable secrets configured: META_APP_ID, META_APP_SECRET, META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_WEBHOOK_VERIFY_TOKEN, META_GRAPH_API_VERSION=v26.0
Leads Access: app allowed: yes/no
Webhook: Page object verified: yes/no; leadgen subscribed: yes/no; Page subscribed_apps: yes/no
Testing Tool lead 1: <lead id> — delivery <status>, Boltz row WEBHOOK/ingested: yes/no, visible in /leads: yes/no
Dedupe: reconcile → missing 0 ingested 0: yes/no; manual import → duplicate: yes/no; duplicate-count query rows: 0
Reconciliation backstop: lead 2 <lead id> → RECONCILIATION/ingested: yes/no; leadgen re-subscribed: yes/no
Cron jobs meta-leads-reconcile-incremental / -nightly: present: yes/no
Instant Form SMS-consent checkbox: added / skipped (Fendi not asked)
Blockers: <none | exact text>
```

Only claim **live success** when the Testing Tool lead is visible in Boltz
(`/leads` and `meta_lead_submissions`). A 200 from Meta alone is not enough.
