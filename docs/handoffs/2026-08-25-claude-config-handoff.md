# Boltz Insight Engine — Handoff to Claude (2026-08-25)

## What this project is
Internal, owner-only ops tool for Boltz Automotive Inc. Two halves:
1. SEO/GEO research + measurement + experiment workflow (localStorage-backed, seeded).
2. RingCentral + Grok SMS lead inbox (Lovable Cloud / Supabase-backed).

It is NOT the public website. boltzautogarage.com stays on Durable.

## Hard guardrails (do not violate)
- No changes to boltzautogarage.com, DNS, Google Business Profile, or ads from this project.
- SEO/GEO publishing freeze until 2026-08-29 10:00 America/Chicago: no title/description/canonical/schema/URL edits, no new service or location pages, no redirects/merges/deletes, no changes to the fixed 48-prompt GEO panel or scoring rules.
- Immutable 2026-08-14 baseline (append only): overall AI share of voice 12.5%; 6/48 full mentions; 5 partial; engine-replacement segment 21.4%; cost, European/luxury, decision/warranty segments 0%.
- Never fabricate metrics. Unmeasured = "Not entered" (null). Measured zero = 0.
- Canonical NAP: Boltz Automotive Inc. (GBP listing "Boltz Auto Inc."), 707 W. 119th St., Chicago, IL 60628, (708) 575-4555, Mon–Sat 9 AM–5 PM (last regular appt ~4 PM), Sunday closed.
- Secrets are entered only through Lovable Cloud server-side secrets. Never into chat, code, forms, or VITE_ vars. Never call RingCentral or xAI from the browser.
- Workflow order is mandatory: finding → hypothesis → proposed intervention → approval → deployment → measurement.

## Current state — verified working
- Auth: Supabase magic-link. Every ops route lives under `src/routes/_authenticated/`; `/auth` is the only public UI route.
- Roles: `public.user_roles` (`app_role` = owner | staff) + security-definer `has_role()` / `is_staff()`. The first account to sign in is auto-granted `owner` by trigger. Roles are never stored on profile/lead rows.
- RLS: all lead-inbox tables require staff; `integration_health_snapshots` and `ringcentral_subscriptions` require owner. `anon` has zero grants. Privileged server fns (`resumeAgentFn`, `ensureSubscription`) re-check owner role because they bypass RLS.
- `lead_events` is append-only by trigger (audit).
- RingCentral: JWT auth returns 200. Extension 63400267007 (ext 101) active. `+17085754555` has `CallerId, SmsSender, MmsSender`.
- Webhook `POST /api/public/ringcentral/webhook`: echoes one-time `Validation-Token` on handshake (200), rejects a wrong `Verification-Token` (401).
- Cron routes `POST /api/public/cron/{renew-subscriptions,reconcile-messages,process-jobs}`: 401 without a valid `Authorization: Bearer <CRON_SECRET>`.
- End-to-end test passed: a simulated inbound SMS created the lead, extracted vehicle + symptoms, and Grok autonomously returned a compliant reply (inspection required for any quote, correct address/hours, no price promise) queued to RingCentral with no approval gate. All test rows were deleted afterward — DB currently holds zero lead data.

## Safeguards in code
- `src/server/lead-inbox/outbound.server.ts`: treats SMS capability `"unknown"` as blocked, same as `"none"`.
- `src/server/lead-inbox/grok.server.ts`: `SUPPORTED_MODELS` allowlist (`grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-0309-*`), `DEFAULT_MODEL = grok-4.6`, `resolveModel()` falls back when `XAI_MODEL` is unsupported. `parseDecision()` is strict Zod: unparseable output, invalid enums, or a `send` with empty text all escalate to a human.
- `src/server/lead-inbox/safety.server.ts`: STOP/opt-out handling, escalation triggers, idempotency by provider message id.

## Secrets currently stored
RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_JWT, RINGCENTRAL_SERVER_URL, RINGCENTRAL_FROM_NUMBER (+17085754555), RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN, XAI_API_KEY, XAI_MODEL (`grok-4.6`), CRON_SECRET, PUBLIC_APP_URL (`https://boltz-insight-engine.lovable.app`).


## Open items for Claude
1. **Register the RingCentral webhook subscription.** Sign in as owner → `/integration-health` → the subscription action calls `renewSubscriptions()`, which creates the subscription against
   `https://boltz-insight-engine.lovable.app/api/public/ringcentral/webhook`.
   Confirm the row lands in `ringcentral_subscriptions` with status `Active` and an `expires_at` ~7 days out.
2. **Schedule the cron jobs** via pg_cron + pg_net against the published URL, `Authorization: Bearer <CRON_SECRET>`:
   - `renew-subscriptions` — every 6 hours (subscriptions expire in 7 days).
   - `reconcile-messages` — every 10 minutes (catches webhook gaps).
   - `process-jobs` — every 2 minutes (drains retries; the webhook also drains inline, max 3).
3. **Live smoke test:** text `+17085754555` from a real handset, confirm a reply within seconds, confirm the thread renders on `/leads`, then text `STOP` and confirm opt-out is recorded and no further replies go out.
4. **Escalation review:** send a message like "I want to talk to a person" and confirm it lands on `/escalations` with no auto-reply.


## Useful paths
- `docs/RINGCENTRAL_HANDOFF.md` — read before any lead-inbox edit.
- `src/lib/lead-inbox.functions.ts` — all UI-facing server functions (user-scoped, RLS applies).
- `src/server/lead-inbox/` — env, ringcentral, grok, safety, store, jobs, cron.
- `src/routes/api/public/` — webhook + cron HTTP routes.
- Cursor foundation branch: `cursor/ringcentral-lead-inbox-6fb9`.
