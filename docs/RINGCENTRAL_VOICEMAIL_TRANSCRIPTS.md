# RingCentral voicemail and call notes

The shop already reads the RingCentral call log and SMS message store with `RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT`, and `RINGCENTRAL_SERVER_URL`. This adds two read paths on that same JWT:

- Voicemails from the shop extension message store, including RingCentral's voicemail transcription when it is ready.
- AI notes and transcripts for connected calls, from the RingSense / AI Conversation Expert insights API.

Nothing in this path sends SMS, places a call, enqueues a first-touch job, or moves a lead past New. `META_AUTO_FIRST_TOUCH` is unchanged.

## What gets stored

Voicemails are rows in `ringcentral_voicemails`, idempotent on the RingCentral message id. Each row keeps the caller phone (E.164), timing, duration, transcription status, and transcription text. Audio files and attachment URIs are not stored.

A caller phone that matches an existing lead or message thread is linked to that lead. The lead's source and lifecycle stay as they are. If there is no lead, one is created with source `RingCentral Voicemail` and lifecycle `New`, using the same phone dedupe as inbound SMS. A phone that cannot be stored as E.164, or that is the shop's own number, is kept as `needs_review` and does not create a lead.

Connected calls (answered) are rows in `ringcentral_call_insights`, idempotent on the call id and the telephony session id. The row stores the summary, transcript, and notes when RingSense returns them, and links an existing lead by the outside party's phone. A call with no matching lead does not create one. Missed calls and voicemail-result calls are not sent to the insights API. The recording file is not downloaded.

Sync watermarks live in `ringcentral_sync_cursors`. Each run looks back over the requested window and also overlaps the previous watermark by 15 minutes, capped at 30 days, so a missed cron and a transcription that finishes later are both picked up. A voicemail or call that is already stored is updated in place.

If the JWT is missing `RingSense`, or the insights endpoint returns 402 or 403, that run logs the permission name and skips call notes. Voicemail sync still runs. A single call with no notes yet is skipped and retried on a later run. The same rule applies when the message store refuses `ReadMessages`.

## Schedule and manual trigger

`POST /api/public/cron/reconcile-ringcentral-voice`

Auth is `Authorization: Bearer <CRON_SECRET>`, same as the other cron routes.

| Query                          | Lookback                                  |
| ------------------------------ | ----------------------------------------- |
| `window=incremental` (default) | 180 minutes                               |
| `window=nightly`               | 7 days                                    |
| `minutes=N`                    | N minutes, from 1 through 43200 (30 days) |

The route does not call `process-jobs`.

Suggested schedule, after the migration is applied. Replace the host and do not put the real bearer in git:

```sql
select cron.schedule('ringcentral-voice-incremental', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://PUBLIC_APP_URL/api/public/cron/reconcile-ringcentral-voice?window=incremental',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);

select cron.schedule('ringcentral-voice-nightly', '20 8 * * *', $$
  select net.http_post(
    url := 'https://PUBLIC_APP_URL/api/public/cron/reconcile-ringcentral-voice?window=nightly',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);
```

Owners can run the same sync from Integration Health: **Sync now (3h)** and **Sync 7 days**. That button requires `integrations.manage`.

Apply `supabase/migrations/20261104220000_ringcentral_voicemail_insights.sql` before the first sync. The tables are service-role only.

## MCP tools

Both tools require the `read` scope. Audit rows store `leadId`, `callId`, and whether a phone was present. They do not store the phone, the transcription, or the transcript.

`boltz_lookup_lead` adds `latestVoicemail` and `latestCallInsight`. Each summary is capped at 500 characters. `voiceAvailable: false` means the new tables are not in this database yet; the lead lookup itself still returns.

### `boltz_voicemails`

| Param    | Required | Meaning                                                                                          |
| -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `since`  | no       | `YYYY-MM-DD` in America/Chicago, or an ISO timestamp. Defaults to 7 days. At most 372 days back. |
| `phone`  | no       | One customer number. Normalized to E.164.                                                        |
| `leadId` | no       | One lead.                                                                                        |
| `limit`  | no       | 1–50. Default 25.                                                                                |

The response is `{ ok, voicemails, truncated }`. Each voicemail includes `providerMessageId`, `leadId`, `phone`, `at`, `transcriptionStatus`, and `transcription` (capped at 8000 characters).

### `boltz_call_insights`

| Param    | Required | Meaning                                                       |
| -------- | -------- | ------------------------------------------------------------- |
| `since`  | no       | Same as voicemails. Omitted when `callId` is the only filter. |
| `phone`  | no       | Outside party, E.164.                                         |
| `leadId` | no       | One lead.                                                     |
| `callId` | no       | RingCentral call id or telephony session id.                  |
| `limit`  | no       | 1–50. Default 25.                                             |

The response is `{ ok, insights, truncated }`. Each insight includes `callId`, `telephonySessionId`, `recordingId`, `summary`, `transcript`, and `notes`. Text fields are capped at 8000 characters. `recordingId` is an id, not a media URL.

## Scopes and secrets

No new secret is required. Keep using:

`RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT`, `RINGCENTRAL_SERVER_URL`, `RINGCENTRAL_FROM_NUMBER`

Application permissions on the app that owns `RINGCENTRAL_CLIENT_ID`:

| Permission     | Why                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `ReadMessages` | List voicemails and read the transcription attachment. SMS reconcile already uses the message store.           |
| `ReadCallLog`  | List connected calls. Already required for `boltz_call_log`.                                                   |
| `RingSense`    | Read AI notes and transcripts. Add this, then issue a new JWT for the same user and replace `RINGCENTRAL_JWT`. |

User permission for the JWT user: `ReadRingSenseInsights` (AI Conversation Expert - Access Insights). Account call history still uses `FullCompanyCallLog` when you want every extension; without it, sync reads the JWT extension, which is the shop line.

`ReadCallRecording` is not required. Do not enable it for this feature. Recordings are not downloaded.

Voicemail-to-text is an account feature. When RingCentral reports `NotAvailable`, the row is stored with that status and no transcription text.
