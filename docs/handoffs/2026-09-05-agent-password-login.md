# Shop-agent password login — owner handoff (2026-09-05)

Shop SMS from Insight Engine needs a signed-in **staff** session. Magic-link-only login kept dropping Grok Bot / shop agents onto `/auth`, so first-touch SMS could not send. Owner magic link still works.

## Status tonight (Rod / +1 773 727-2239)

Password login is **live**. `info@boltzautoinc.com` already has a password and signed in at 8:37 PM CT. Shop SMS from Insight Engine then went out on the Rod / Takia Jordan Monte Carlo thread (first outbound 8:39 PM CT). Rod is in an active two-way text; latest inbound ~8:58 PM CT is waiting for ops — no reply is drafted here.

Tonight’s unblock does **not** require creating `agents@` first. Owner can keep using **Shop agent** tab + `info@boltzautoinc.com` + password, Stay signed in on. Create the dedicated `agents@` staff user when you can so Grok Bot is not tied to the owner mailbox.

## What shipped

- `/auth` has two tabs: **Shop agent** (email + password) and **Owner magic link**.
- Stay signed in stays **on by default** for both paths. The auth gate no longer treats a transient error as logout (that was still dumping people to `/auth` after Chrome restart).
- Dedicated shop-agent account should be **staff**, not owner. Integration Health and Google Ads stay hidden for staff. Staff can send SMS; they cannot confirm Paid / manage integrations.
- Optional one-click **Use stored shop-agent login** appears only after Lovable secrets are set. The password never goes to the browser, never goes into git, and is never returned by the API.
- **Grok auto-login:** if `AGENT_AUTH_EMAIL` + `AGENT_AUTH_PASSWORD` are set and Stay signed in is on, a dropped session is restored silently (auth page + keepalive). Explicit **Sign out** in that tab stays signed out until Chrome restart. Inbound Grok SMS replies already run on the server without a browser cookie.
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
5. After those secrets are set, Grok / shop computers auto-sign back in if Chrome drops the session. No magic link click required.

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
