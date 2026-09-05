# Shop-agent password login — owner handoff (2026-09-05)

Shop SMS from Insight Engine needs a signed-in **staff** session. Magic-link-only login kept dropping Grok Bot / shop agents onto `/auth`, so first-touch SMS could not send. Owner magic link still works.

## What shipped

- `/auth` has two tabs: **Shop agent** (email + password) and **Owner magic link**.
- Stay signed in stays **on by default** for both paths. The auth gate no longer treats a transient error as logout (that was still dumping people to `/auth` after Chrome restart).
- Dedicated shop-agent account should be **staff**, not owner. Integration Health and Google Ads stay hidden for staff. Staff can send SMS; they cannot confirm Paid / manage integrations.
- Optional one-click **Use stored shop-agent login** appears only after Lovable secrets are set. The password never goes to the browser, never goes into git, and is never returned by the API.
- Automated inbound Grok replies already send from the server (cron / webhook) without a browser cookie. Manual first-touch SMS still uses the signed-in staff session. A public cookie-less send API was not added because the live app URL is public.

## One-time setup (Fendi)

Do this in Supabase / Lovable Cloud. Do not paste the password into chat or the repo.

1. **Create the Auth user** in Lovable Cloud → Supabase → Authentication → Users → Add user.
   - Email: `agents@boltzautoinc.com` (same domain as the owner account `info@boltzautoinc.com`).
   - Password: generate a long random password. Store it only in Lovable secrets.
   - Confirm / auto-confirm the user so they can sign in immediately.
   - Do **not** use the owner mailbox `info@boltzautoinc.com` for this.

2. **Grant staff only** (never `owner`) in the SQL editor, after the user exists:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'staff'
FROM auth.users
WHERE email = 'agents@boltzautoinc.com'
ON CONFLICT (user_id, role) DO NOTHING;
```

3. **Lovable secrets** (Project → Cloud → Secrets). Names must match exactly:

| Secret | Value |
| --- | --- |
| `AGENT_AUTH_EMAIL` | `agents@boltzautoinc.com` |
| `AGENT_AUTH_PASSWORD` | the password from step 1 |

4. Confirm on `/integration-health` (owner login) that both secrets show **Configured**. Values are never displayed.

## How agents sign in

1. Open https://boltz-insight-engine.lovable.app/auth
2. Stay on **Shop agent**.
3. Enter `agents@boltzautoinc.com` and the password, **or** click **Use stored shop-agent login** after secrets are set.
4. Leave **Stay signed in** checked.
5. Lead Inbox → New SMS / reply. That session is what authorizes outbound SMS.

Owner humans: **Owner magic link** tab, `info@boltzautoinc.com`, same as before.

## If SMS still will not send

- The signed-in user must have `staff` or `owner` in `user_roles`. A login without a role is signed back out.
- RingCentral secrets and SMS capability must still be healthy (owner Integration Health).
- Yelp via Gmail is unchanged and does not use this login.
