# Shop desk

The shop desk is a counter screen inside Boltz Insight Engine. Reception and shop assistants use it to see lead interactions and to record walk-ins and phone calls in the same `leads` table as Meta, Yelp, website, and Google Ads form leads. It is not a separate app.

## Routes

| Route                       | What it is                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- |
| `/desk`                     | Desk home. **New walk-in** and **New phone lead** are the two primary buttons.  |
| `/desk/new?channel=walk_in` | Walk-in form. `channel=phone` opens the phone form.                             |
| `/desk/leads`               | Searchable recent leads (phone, name, vehicle, source, concern).                |
| `/desk/leads/$leadId`       | Lead detail: status, source, Square payment match, read-only SMS thread, notes. |

The sidebar entry is **Shop desk**, under Leads. Staff and the owner both see it. Integration Health, Google Ads, and Square stay owner-only.

Sign-in is the existing `/auth` page. The **Shop agent** tab is email + password. The **Owner** tab is the magic link. There is no new login.

## Auth and the first receptionist

Shop assistants use the existing `staff` role (`public.app_role`). `is_staff` is true for `staff` and `owner`. A separate `shop_assistant` role was not added. The owner keeps `owner` and full access, including integrations and marking a lead Paid through the Square path.

Staff can read and write leads, threads, and messages through the policies already on those tables. They cannot read MCP tokens, Square keys, integration secrets, or `google_ads_call_numbers` (caller numbers). The desk server reads caller numbers with the service role after a staff capability check, and it returns only the match for that lead.

Invite a receptionist:

1. In Supabase Auth, create a user with their email and a password, and mark the email confirmed. Do not reuse the owner address or `info@boltzautoinc.com`.
2. Grant `staff` only. Replace the email in this statement:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'staff'
   from auth.users
   where email = 'receptionist@example.com'
   on conflict do nothing;
   ```

   Do not insert `owner`.

3. They open `/auth`, choose **Shop agent**, and sign in. Then open `/desk`.
4. The shared shop-computer login (`agents@boltzautoinc.com`, documented in `docs/handoffs/2026-09-05-agent-password-login.md`) is also `staff`. A named receptionist is better so `leads.created_by` is that person.

`created_by`, `intake_path = 'desk'`, `desk_idempotency_key`, and `google_ads_call_id` can be written only by the service role (the desk server). A staff JWT cannot set them, and cannot move a lead to Paid. The guard reads the role the same way `auth.role()` does: `request.jwt.claim.role`, then `request.jwt.claims`. Square and the lifecycle RPC run as `service_role`.

## Recording a lead

Required: channel (Walk-in or Phone) and **How did you hear about us?**

Encouraged: name and phone. The phone is normalized to E.164 (`+13125550100`). An unusable number is rejected. A blank phone is allowed for a walk-in who will not give one.

Optional: vehicle year / make / model, concern (stored in `symptoms`), appointment interest, notes.

Save inserts one `leads` row with `lifecycle = New`, `intake_path = 'desk'`, `intake_channel`, `heard_about` (the pick key), `created_by` (the signed-in user), and `lead_source` (the reporting value below). A `lead_events` row of type `desk_intake` records the channel and pick. The event does not store the name, phone, or note text.

### Same phone

`leads.phone_e164` is unique, so the desk never inserts a second card for a number.

- Created in the last **12 hours**: the form shows the existing lead and offers **Add note**.
- Older than 12 hours: same screen, worded as an existing customer. Add a note. Still one row.
- Saving the same form twice uses a client idempotency key, so a double tap does not create two nameless walk-ins.

## Source pick-list

The pick is stored in `heard_about`. Weekly ads and Square sales group on `lead_source`, the same column online intake already fills. These are not a second taxonomy.

| Desk pick                                              | `heard_about` | `lead_source`                                                                       |
| ------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------- |
| Google, and the phone matches a recent Google Ads call | `google`      | `Google Ads`                                                                        |
| Google, no Ads-call match                              | `google`      | `Google Business Profile`                                                           |
| Yelp                                                   | `yelp`        | `Yelp`                                                                              |
| Facebook/Meta                                          | `facebook`    | `Facebook Lead Ads`                                                                 |
| Instagram                                              | `instagram`   | `Instagram Lead Ads`                                                                |
| Referral / friend                                      | `referral`    | `Referral`                                                                          |
| Returning customer                                     | `returning`   | `Returning customer`                                                                |
| Drive-by / saw shop                                    | `drive_by`    | `Drive-by`                                                                          |
| Other                                                  | `other`       | The short text, or the canonical source if they typed one (`Google Ads`, `Yelp`, …) |

`Yelp`, `Google Ads`, `Google Business Profile`, `Google LSA`, `Facebook Lead Ads`, and `Instagram Lead Ads` are the strings email and Meta intake already write. Referral, returning, and drive-by had no online bucket; they use `lead_source` so the Square rollup can group them. `Other` that does not match a known source is stored as that short phrase in `lead_source` (letters, numbers, spaces). A walk-in who says "Google" stays in **Google Business Profile**, not the ads bucket.

If a lead already has a source, changing it requires the confirm checkbox. Filling a blank source does not.

## Google Ads phone calls

`ads_call_weekly` stores counts and durations for a week. It does not store caller numbers. The call report query is unchanged and still does not select caller fields.

Exact matches live in `google_ads_call_numbers` (`phone_e164`, `started_at`, `week_start`, `customer_id`, optional `ads_call_weekly_id`). Row level security is forced. `anon` and `authenticated` have no grants. The desk looks up the number the receptionist just typed, within **14 days**, and only for a phone lead.

When it matches:

- The lead's `google_ads_call_id` points at that row, including when the phone already belonged to an older lead (no second card).
- If the pick is Google, or the current source is blank or `Google Business Profile`, `lead_source` becomes `Google Ads`.
- If the source is already Yelp or another non-Google source, that source stays. The link is still saved. The detail screen says the number matches a Google Ads call.

A Google Ads **form** lead is already a `leads` row with `lead_source = 'Google Ads'` and the form phone. Logging that phone at the desk opens that row. That is the link for form leads.

Caller numbers are not pulled from Google Ads in this change, because `call_view` in the weekly report does not include them. To turn a known Ads call into a match, insert it with the service role (SQL editor or a server job). Use the real E.164, the call time, the Monday `week_start` in America/Chicago, and the Ads customer id. `ads_call_weekly_id` can be null.

```sql
insert into public.google_ads_call_numbers (
  phone_e164, started_at, week_start, customer_id, ads_call_weekly_id
) values (
  '+15555550123',
  timestamptz '2026-10-09 15:04:00-05',
  '2026-10-05',
  '1234567890',
  null
);
```

Do not put customer numbers in chat, logs, or audit summaries. The table comment says the same thing.

## How desk leads show up in reporting

Square's weekly view groups completed payment gross by `leads.lead_source` (`square_revenue_weekly.attributed_by_source` in `docs/SQUARE.md`). A desk Yelp lead and an email Yelp lead share the `Yelp` bucket. A desk phone lead linked to an Ads call shares the `Google Ads` bucket with form leads. A walk-in who says Google shares `Google Business Profile` with GBP email leads. Referral, returning, and drive-by appear under those exact strings. A blank source is still `unknown`.

`intake_path = 'desk'` separates counter entry from online entry without changing the source rollup. `created_by` is the staff user id.

The desk does not send SMS. Threads on the detail screen are read-only. Texts stay on **Lead Inbox**. Status changes use the existing lifecycle rules (`transitionLeadLifecycle`): staff can move to Contacted, No-show, and the other allowed steps, and cannot mark Paid. The database trigger rejects a staff JWT that sets `lifecycle` to Paid, including when the role is only in `request.jwt.claims`. Square's service role still can.

## Migration

`supabase/migrations/20261009183000_shop_desk.sql`

`supabase/migrations/20261009193000_protect_desk_columns_jwt_claims.sql` replaces `protect_lead_desk_columns()` so an authenticated session is still blocked when Supabase sends the role only in `request.jwt.claims`.

Apply both with the usual Supabase migration path before using the desk against production. Publishing the Lovable app is a separate step.

## PII

Desk server logs are static failure strings. They do not include names, phones, emails, or note text. `lead_events` summaries for desk actions are fixed phrases. Note bodies live on `leads.notes`, which staff already read. `google_ads_call_numbers` is service-role only.
