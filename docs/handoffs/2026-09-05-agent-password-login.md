# Shop-agent password login — setup handoff (2026-09-05)

For Fendi. App: https://boltz-insight-engine.lovable.app. No public-site, DNS, GBP, RingCentral,
or Grok changes are involved.

## What shipped

- `/auth` now has two tabs: **Shop agent** (email + password, default) and **Owner magic link**
  (unchanged `signInWithOtp`). Stay-signed-in stays default ON for both.
- If `AGENT_AUTH_EMAIL` + `AGENT_AUTH_PASSWORD` are both set, `/auth` also shows
  **Use stored shop-agent login**. That button calls a server function which signs in server-side,
  verifies `is_staff`, and returns only access/refresh tokens. The password never reaches the browser.
- The `/_authenticated` gate no longer redirects on any error — only a missing user, or an explicit
  `is_staff = false`, sends someone back to `/auth`. Network errors keep the restored session.
- Integration Health lists `AGENT_AUTH_EMAIL` / `AGENT_AUTH_PASSWORD` as Configured/Missing only.
- Integration Health and Google Ads nav entries are hidden for non-owners.

## What you need to do

1. **Create the agent Auth user** — email `agents@boltzautoinc.com`, set a strong password, and
   mark it confirmed. Do **not** reuse `info@boltzautoinc.com`.
2. **Grant staff only**:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'staff' from auth.users where email = 'agents@boltzautoinc.com'
   on conflict do nothing;
   ```

   Do not insert `owner`. The agent must not get `integrations.manage` or
   `financial_status.confirm`.
3. **Set the two Lovable secrets** (server-side entry only, never in chat/code/`VITE_`):
   - `AGENT_AUTH_EMAIL` = `agents@boltzautoinc.com`
   - `AGENT_AUTH_PASSWORD` = the password you set in step 1
4. Republish, open `/auth`, sign in on the Shop agent tab, confirm Lead Inbox loads and that
   Integration Health / Google Ads are not in the sidebar.

## Notes

- Stored-agent login is IP rate limited: 5 failures per 15 minutes, then exponential backoff.
- Silent auto-login (Grok Bot / shop-computer recovery after Chrome drops the session) requires
  both `AGENT_AUTH_EMAIL` and `AGENT_AUTH_PASSWORD` to be set; it runs only when Stay signed in is
  on and is suppressed per-tab after a manual Sign out until Chrome restarts.
- Sign-in errors are generic on purpose; provider text is never echoed.
- SMS sending still requires a staff JWT (`communications.send`). No cookie-less public send API
  was added.
