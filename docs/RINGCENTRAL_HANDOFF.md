# RingCentral + Grok Lead Inbox — implementation handoff

Internal Boltz Automotive tooling. The public site stays on Durable
(`boltzautogarage.com`). Nothing here changes DNS, GBP, ads, public pages, or the
SEO/GEO experiment-approval workflow.

## Surfaces

| Path | Kind | Auth |
| --- | --- | --- |
| `/leads` | UI | owner sign-in required |
| `/escalations` | UI | owner sign-in required |
| `/integration-health` | UI | owner sign-in required |
| `/api/public/ringcentral/webhook` | server route | Echoes handshake `Validation-Token`; verifies notification `Verification-Token` |
| `/api/public/cron/process-jobs` | server route | `Authorization: Bearer CRON_SECRET` |
| `/api/public/cron/reconcile-messages` | server route | `Authorization: Bearer CRON_SECRET` |
| `/api/public/cron/renew-subscriptions` | server route | `Authorization: Bearer CRON_SECRET` |

**Path note:** the original handoff named `/api/ringcentral/webhook` and
`/api/cron/*`. On this stack every route outside `/api/public/*` is blocked by
site auth on deployed URLs, so external callers (RingCentral, pg_cron) could never
reach them. The endpoints therefore live under `/api/public/*` and authenticate
themselves in-handler.

## Server modules (`src/server/lead-inbox/`, server-only)

- `env.server.ts` — secret reads, presence-only status, masked identifiers, constant-time compare.
- `ringcentral.server.ts` — JWT OAuth (token cached), phone-number/SMS-capability probe,
  `SmsSender` vs `A2PSmsSender` send paths, subscription create/renew/get, message-store list.
- `grok.server.ts` — xAI chat completion with a Boltz-fact-locked system prompt returning a
  strict JSON decision (`send` / `escalate` / `no_reply`), lead field updates, lifecycle proposal.
- `safety.server.ts` — deterministic pre-model rules: STOP/START keywords, escalation triggers,
  and outbound validation (blocks discount, free-service, guarantee, warranty, hours claims).
- `store.server.ts` — lead/thread/message persistence, append-only `lead_events`, job queue with
  lease-based claiming and capped retries, escalation open, health snapshots.
- `jobs.server.ts` — bounded batch processing (10 per run), inbound pipeline, circuit breaker.
- `cron.server.ts` — bearer auth, subscription renewal/creation, missed-webhook reconciliation.

## Inbound pipeline

1. Webhook echoes RingCentral’s one-time handshake `Validation-Token`, verifies the configured\n   `Verification-Token` on normal notifications, then enqueues one `process_inbound` job keyed by the
   provider message id (database-deduplicated; replays are no-ops) and drains at most 3 jobs inline.
2. Job creates/reuses the lead + thread, stores the inbound message (idempotent on
   `provider_message_id`).
3. Deterministic rules run first: opt-out sets `consent_status = opted_out` and sends one
   confirmation; opted-out leads never receive automated replies; safety triggers open an
   escalation and flip the thread to human control.
4. Otherwise Grok decides. `send` goes out immediately (no draft/approve gate) after outbound
   validation; `escalate` opens an escalation; every run is recorded in `agent_runs` with model,
   prompt version, policy tags and audit summary.

## Runaway protection

- Fixed batch size, per-job attempt cap with exponential backoff, `dead` terminal state.
- Lease-based claim (`locked_at`) so concurrent runs cannot double-process.
- Circuit breaker: xAI `402`/`403` pauses the agent in `integration_health_snapshots`
  (`provider = xai`, `check_name = agent_circuit`). While paused, each run processes at most one
  probe job; a success auto-resumes, and the owner can resume from `/integration-health`.
- Reconciliation is bounded (180-minute look-back, 100 records) and dedupes in the database.

## Secrets (Lovable Cloud server-side only)

`RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT`,
`RINGCENTRAL_SERVER_URL`, `RINGCENTRAL_FROM_NUMBER` (+17085754555),
`RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN`, `XAI_API_KEY`, `XAI_MODEL`, `CRON_SECRET`
(`LOVABLE_CRON_SECRET` is accepted), `PUBLIC_APP_URL`.

Values are never rendered, logged, or returned — `/integration-health` shows
Configured/Missing plus masked identifiers only. `.env.example` stays blank.

## Cron scheduling (after publish, once `PUBLIC_APP_URL` is set)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('lead-inbox-process-jobs', '* * * * *', $$
  select net.http_post(
    url := 'https://PUBLIC_APP_URL/api/public/cron/process-jobs',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);

select cron.schedule('lead-inbox-reconcile', '*/15 * * * *', $$ /* reconcile-messages */ $$);
select cron.schedule('lead-inbox-renew-subs', '0 */6 * * *', $$ /* renew-subscriptions */ $$);
```

The webhook subscription must point at the stable deployed URL; it is created and renewed by
`renew-subscriptions` (or the button on `/integration-health`).
