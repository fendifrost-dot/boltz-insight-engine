# Shop-agent password login — owner handoff (2026-09-05)

Shop SMS from Insight Engine needs a signed-in **staff** session. Magic-link-only login kept dropping Grok Bot / shop agents onto `/auth`, so first-touch SMS could not send. Owner magic link still works.

## Status tonight (Rod / +1 773 727-2239)

Password login is **live**. `info@boltzautoinc.com` already has a password and signed in at 8:37 PM CT. Shop SMS from Insight Engine then went out on the Rod / Takia Jordan Monte Carlo thread (first outbound 8:39 PM CT). Rod is in an active two-way text; latest inbound ~8:58 PM CT is waiting for ops — no reply is drafted here.

Tonight’s unblock does **not** require creating `agents@` first. Owner can keep using **Shop agent** tab + `info@boltzautoinc.com` + password, Stay signed in on. Create the dedicated `agents@` staff user when you can so Grok Bot is not tied to the owner mailbox.

## What shipped

- `/auth` has two tabs: **Shop agent** (email + password) and **Owner magic link**.
- Stay signed in stays **on by default** for both paths. The auth gate no longer treats a transient error as logout (that was still dumping people to `/auth` after Chrome restart).
- Dedicated shop-agent account should be **staff**, not owner. Integration Health and Google Ads stay hidden for staff. Staff can send SMS; they cannot confirm Paid / manage integrations.
- Optional one-click **Use stored shop-agent login** appears after Lovable env secrets **or** the Vault bootstrap (`read_agent_auth_secret`) is present. The password never goes to the browser, never goes into git, and is never returned by the API.
- **Grok auto-login:** if those credentials exist and Stay signed in is on, a dropped session is restored silently (auth page, `/` gate, and keepalive). Overnight Chrome localStorage drops recover from the first-party `boltz_owner_rt` cookie first; Vault shop-agent password login is the fallback for a fresh browser with no cookie. Explicit **Sign out** in that tab stays signed out until Chrome restart. Inbound Grok SMS replies already run on the server without a browser cookie.
- Automated inbound Grok replies already send from the server (cron / webhook) without a browser cookie. Manual first-touch SMS still uses the signed-in staff session. A public cookie-less send API was not added because the live app URL is public.

## Production bootstrap (2026-09-05 morning)

`agents@boltzautoinc.com` is created as **staff** by migration `20260905141100_provision_shop_agent_vault_login.sql`. The password is generated in-database and stored only in Supabase Vault (`AGENT_AUTH_EMAIL` / `AGENT_AUTH_PASSWORD`). Env secrets still win if later set in Lovable Cloud. Do not paste the password into chat.

Optional later: copy the same two names into Lovable Cloud secrets if you want env to override Vault. Confirm presence-only on `/integration-health` (owner). After bootstrap, Grok / shop computers auto-sign back in if Chrome drops the session. No magic link click required.

## Stored-login button and `agents@`

- **`agents@boltzautoinc.com` exists** in Supabase Auth, email confirmed, **staff only** (not owner).
- **Use stored shop-agent login** appears when Vault (`AGENT_AUTH_EMAIL` / `AGENT_AUTH_PASSWORD`) **or** Lovable env secrets are present. The password is not typed. Env wins if both exist.
- After Chrome quit, `/leads` restores from the **HttpOnly** `boltz_owner_rt` cookie on the **server** (JS `document.cookie` cannot read HttpOnly — that was the shop Chrome failure). If the cookie is gone or the refresh token was already rotated, Vault shop-agent login is the fallback. `/auth` uses `useServerFn` for both cookie restore and stored login; raw `createServerFn` imports can no-op in the published app.

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
