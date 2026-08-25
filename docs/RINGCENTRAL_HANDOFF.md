# RingCentral + Grok Lead Inbox — Handoff

Private Boltz Automotive lead inbox foundation (server, database, integrations).
Public website remains on Durable (`boltzautogarage.com`). Do not change DNS, GBP, public pages, advertising, or the SEO experiment-approval workflow.

## Architecture / data flow

```
RingCentral SMS
  → POST /api/ringcentral/webhook  (validate, idempotent store, enqueue job, return fast)
  → POST /api/cron/process-jobs    (claim durable jobs)
  → Grok agent (xAI Responses API) with deterministic pre/post safety
  → shared outbound sender → RingCentral SMS / A2P endpoint
  → Supabase tables (leads, threads, messages, agent_runs, escalations, …)
  → Authenticated Lead Inbox UI (/leads)
```

Reconciliation: `POST /api/cron/reconcile-messages` reads Message Store and enqueues missed inbounds.
Subscription renewal: `POST /api/cron/renew-subscriptions` (not an in-memory timer).

All outbound sends (manual + automated) go through `src/server/lead-inbox/outbound.server.ts`.
`New → Contacted` only after RingCentral accepts an outbound message. Lifecycle transitions are append-only `lead_events`.

## Secret names (never commit values)

Server-only (no `VITE_` prefix):

| Name | Purpose |
| --- | --- |
| `RINGCENTRAL_CLIENT_ID` | JWT OAuth client id |
| `RINGCENTRAL_CLIENT_SECRET` | JWT OAuth client secret |
| `RINGCENTRAL_JWT` | Server-to-server JWT assertion |
| `RINGCENTRAL_SERVER_URL` | `https://platform.ringcentral.com` or sandbox host |
| `RINGCENTRAL_FROM_NUMBER` | E.164, expected `+17085754555` |
| `RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN` | Cryptographically random verification token |
| `XAI_API_KEY` | xAI API key for Grok |
| `XAI_MODEL` | Text model id (e.g. current grok text model) |
| `CRON_SECRET` | Bearer token for cron routes |
| `PUBLIC_APP_URL` | Stable deployed origin for webhook subscription |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Existing Cloud DB |

Blank template: `.env.example`. `.env` must not be tracked (`git ls-files .env` → empty).

**Rotate any genuine secret that was previously committed while `.env` was tracked.**

## Migration

File: `supabase/migrations/20260825160000_lead_inbox_foundation.sql`

Creates: `leads`, `lead_events`, `message_threads`, `messages`, `message_jobs`, `agent_runs`, `escalations`, `ringcentral_subscriptions`, `integration_health_snapshots` (+ enums, indexes, append-only trigger on `lead_events`, RLS for authenticated owner portal; anon denied).

TypeScript types: `src/integrations/supabase/types.ts` (regenerated to match migration).

### Apply order

1. Confirm `.env` is untracked on the deployed branch.
2. Enter secrets via Lovable Cloud secure server-side secret UI (not chat, not client `VITE_`).
3. Apply migration SQL against the project database (Lovable Cloud / Supabase).
4. Deploy app (stable URL).
5. Set `PUBLIC_APP_URL` to that stable origin.
6. From Integration Health UI (or server fn) create SMS webhook subscription.
7. Schedule cron callers with `Authorization: Bearer $CRON_SECRET`:
   - `/api/cron/renew-subscriptions` (e.g. hourly)
   - `/api/cron/reconcile-messages` (e.g. every 15 minutes)
   - `/api/cron/process-jobs` (e.g. every minute)

## Stable webhook path

```
{PUBLIC_APP_URL}/api/ringcentral/webhook
```

- On subscription create, RingCentral sends `Validation-Token` — handler echoes it exactly.
- Later deliveries must include the configured verification token (`RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN`).
- Handler does not wait on Grok; it enqueues `process_inbound` jobs.

## Subscription create / renew

1. Authenticate JWT → resolve extension → confirm `+17085754555` has `SmsSender` or `A2PSmsSender`.
2. Create subscription with event filter  
   `/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS`  
   and `deliveryMode.verificationToken`.
3. Persist row in `ringcentral_subscriptions` (expiration + renewal errors recorded).
4. Cron renews before expiry; failures stored in `last_renewal_error` (no secrets).

If the number is A2P-only, sends use `/a2p-sms/batches` — never silently the standard `/sms` endpoint. If neither capability is present, setup surfaces a clear error.

## Sandbox vs production

| | Sandbox | Production |
| --- | --- | --- |
| `RINGCENTRAL_SERVER_URL` | RingCentral sandbox platform host | `https://platform.ringcentral.com` |
| From number | Sandbox SMS-enabled number | `+17085754555` |
| `PUBLIC_APP_URL` | Stable staging deploy | Stable production deploy |
| Webhook | Must be publicly reachable HTTPS | Same |

Do not point production RingCentral at a temporary Lovable preview URL.

## How Lovable should connect secrets + UI

Cursor already added:

- Lead Inbox UI: `/leads`
- Escalations: `/escalations`
- Integration health: `/integration-health`
- Nav entries under Operate

Lovable should:

1. Sync/merge this branch.
2. Collect secrets only through Lovable Cloud secure secret entry.
3. Apply the migration.
4. Publish a stable deployment URL; set `PUBLIC_APP_URL`.
5. Create the webhook subscription from Integration Health.
6. Wire cron/scheduler to the three `/api/cron/*` routes.
7. Verify RLS: anon cannot read `messages`; owner auth still works.
8. Do **not** add approve/draft/pending-approval message gates.
9. Do **not** call RingCentral or xAI from browser code.
10. Preserve SEO/GEO screens and approval workflow unchanged.

Status UI may show only `Configured` / `Missing` or masked identifiers (e.g. `+1******4555`).

## Rollback

1. Disable cron callers and delete/disable the RingCentral subscription in RC admin + `ringcentral_subscriptions`.
2. Redeploy previous app revision.
3. Optional DB rollback: drop lead-inbox tables/enums from the migration (destructive — export data first). SEO/GEO local datasets are unaffected (browser/local store).

## Known blockers

- Live RingCentral JWT, client credentials, and xAI key must be entered in Lovable Cloud before real SMS/Grok verification.
- `PUBLIC_APP_URL` must be a stable published URL before subscription creation.
- A2P registration / number SMS capability must be valid on the authenticated extension or setup fails loudly.
- xAI model id must be an available text model for the account (`XAI_MODEL`).

## Grok note for the Grok-bot team

The inbox uses a small server-side xAI adapter for structured SMS decisions. If the team already runs external Grok bots, you can keep `XAI_*` configured for this inbox path or later swap the adapter — do not remove deterministic opt-out, idempotency, or escalation gates.
