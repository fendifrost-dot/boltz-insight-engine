# Customer outreach (proposal scaffolding)

This folder is **inert**. It exists so the proposal has a named place for flags
and a hard stop if anyone later calls send by mistake.

It is **not** imported by:

- `src/server/lead-inbox/outbound.server.ts`
- `src/server/lead-inbox/jobs.server.ts`
- `src/routes/api/public/cron/*`

## Flags (all false)

| Flag | Default | What turning it on would mean *after a later build PR* |
| --- | --- | --- |
| `CUSTOMER_OUTREACH_ENABLED` | `false` | Allow the outreach module to load due/queue data in the admin UI. Still no texts. |
| `CUSTOMER_OUTREACH_SQUARE_SYNC_ENABLED` | `false` | Allow a scheduled or button-triggered Square pull into our tables. Still no texts. |
| `CUSTOMER_OUTREACH_SEND_ENABLED` | `false` | **Dangerous later.** Would let the daily drain call `sendOutbound()` for `approved` queue rows during 9–5 Mon–Sat Chicago time. Do not flip until the owner has approved a live week and consent is marked. |
| `CUSTOMER_OUTREACH_CHECKIN_ENABLED` | `false` | Would enqueue post-service check-ins. Still requires the send flag to actually text. |

In **this** commit, `assertOutreachSendAllowed()` always throws. Flipping a
boolean here cannot reach RingCentral.

## Token (not created yet)

A future Square token would live in Lovable Cloud secrets as
`SQUARE_ACCESS_TOKEN`, same as `RINGCENTRAL_*`. Never in the database, never
in `VITE_` variables, never in this repo.
