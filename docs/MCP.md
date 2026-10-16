# Boltz Insight MCP

Remote MCP connector for shop bots (lead follow-up, chief of staff, and the others). Streamable HTTP, JSON responses. The bot reads leads, threads, and the RingCentral call log, and sends SMS through the same path as `POST /api/public/bot`. It does not use `BOT_API_SECRET`, a staff session, or `CRON_SECRET`.

After a Lovable publish:

```text
https://boltz-insight-engine.lovable.app/api/public/mcp
```

Send `Authorization: Bearer <token>` and `Content-Type: application/json`. The token is not accepted in the URL. A missing or unknown token gets **401**. `GET` is **405** (the route is there; JSON-RPC is `POST`).

An unauthenticated check:

```bash
curl -sS -D - -o /tmp/mcp-body.json -X POST \
  "https://boltz-insight-engine.lovable.app/api/public/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```

Expect HTTP 401 and a JSON-RPC error. The body does not echo the header.

## Enrollment

Generate a token on your machine. Insert only its SHA-256 hex digest. The table has no secret column, and this app never sees the token until a bot sends it.

```bash
printf '%s' "$BOLTZ_MCP_TOKEN" | sha256sum | awk '{print $1}'
```

`printf '%s'` keeps a trailing newline out of the hash. The digest is 64 lowercase hex characters.

```sql
insert into public.mcp_agents (name, secret_hash, scopes)
values (
  'lead-follow-up',
  '<sha256-hex-of-token>',
  array['read', 'send']::text[]
);
```

`name` matches `^[a-z][a-z0-9_-]{0,63}$` (examples: `lead-follow-up`, `chief-of-staff`). Scopes are `read`, `send`, and `leads.write`. One row can hold any non-empty subset. `botName` on a send must equal this name.

Optional expiry:

```sql
insert into public.mcp_agents (name, secret_hash, scopes, expires_at)
values (
  'chief-of-staff',
  '<sha256-hex-of-token>',
  array['read', 'leads.write']::text[],
  now() + interval '180 days'
);
```

Revoke one credential. Other agents are unaffected. To rotate, insert a new hash (the name does not have to be unique) and revoke the old row.

```sql
update public.mcp_agents
set revoked_at = now()
where id = '<agent-uuid>'
  and revoked_at is null;
```

Browser roles cannot read these tables. RLS is enabled and forced, `anon` and `authenticated` have no grants and no policies, and only `service_role` (the server) can use them.

## Call shape

`initialize`, `tools/list`, and `tools/call`. A notification such as `notifications/initialized` gets **202**. Batch requests are rejected. Every authenticated call writes `mcp_audit_log` before the work runs (`agent_id`, tool name, an args summary, `result_code`). The summary stores lengths and flags, not message bodies, phone numbers, emails, or names. If the audit insert fails, the tool does not run.

## Tools

| Tool                       | Scope                   | What it does                                                                                                                                                                                         |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boltz_whoami`             | any authenticated agent | Agent name and scopes. No token.                                                                                                                                                                     |
| `boltz_lookup_lead`        | `read`                  | One lead by `phone`, `email`, or `leadId`, plus its thread.                                                                                                                                          |
| `boltz_list_leads`         | `read`                  | Recent leads. `source`, `status` (lifecycle), `since`, `limit` (1–100, default 25). Default `since` is 7 days.                                                                                       |
| `boltz_thread_messages`    | `read`                  | Messages on a thread (`phone`, `leadId`, or `threadId`).                                                                                                                                             |
| `boltz_call_log`           | `read`                  | Read-only RingCentral call history. `since` can be 372 days back. `mode` `summary` groups outside numbers. Does not send SMS. Opted-out numbers are included.                                      |
| `boltz_inbound_since`      | `read`                  | Inbound SMS since an ISO timestamp, at most 30 days back.                                                                                                                                            |
| `boltz_lead_status`        | `read`                  | Lifecycle, consent, and `optedOut` (consent or a latest inbound STOP / UNSUBSCRIBE / CANCEL / END / QUIT).                                                                                           |
| `boltz_integration_health` | `read`                  | Which secrets are configured (never the values), recent checks, SMS capability.                                                                                                                      |
| `boltz_ads_weekly`         | `read`                  | The existing read-only Google Ads weekly report. `days` is 1–90, default 7.                                                                                                                          |
| `boltz_ads_calls`          | `read`                  | The existing Google Ads call report. Omit dates for the last full Monday–Sunday week in America/Chicago.                                                                                             |
| `boltz_square_revenue`     | `read`                  | Square weekly revenue. `since` and `until` are YYYY-MM-DD week starts. Gross, net, refunds, ticket count, average ticket, and lead-attributed gross by source. No customer names, phones, or emails. |
| `boltz_square_payments`    | `read`                  | Recent Square payments, or the payments linked to one `leadId`. Amount, status, match, card brand, and last 4.                                                                                       |
| `boltz_disputes`           | `read`                  | Stored Square disputes, sorted by due date. Set `disputeId` for one dispute plus its evidence checklist, linked lead, SMS thread ids, same-card payments, and invoices. `dueWithinDays` keeps disputes that still need a response and are due inside that window, including overdue. No phones, emails, message bodies, or file URLs. Does not submit evidence to Square. |
| `boltz_send_sms`           | `send`                  | One SMS through the bot send path.                                                                                                                                                                   |
| `boltz_update_lead`        | `leads.write`           | Replace notes and/or move lifecycle under the staff rules. Cannot mark Paid.                                                                                                                         |

`boltz_ads_calls` stores the weekly aggregate the same way `POST /api/public/cron/ads-calls` does. It does not send a text.

### Call log

`boltz_call_log` reads the RingCentral call log with the same JWT the shop already uses for SMS (`RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT`, `RINGCENTRAL_SERVER_URL`). It does not send a text. Numbers that have opted out are still returned.

`since` is required. `until` defaults to now. Both accept `YYYY-MM-DD` in America/Chicago or an ISO timestamp. `since` can be up to 372 days before today. `direction` is `inbound` or `outbound`. `phone` matches either party. `weekday` is a Chicago weekday name such as `Friday`. `line` is `any` (default) or `main` (only calls that involve `RINGCENTRAL_FROM_NUMBER`). `mode` is `list` (default) or `summary`.

List rows include the Chicago time and offset, weekday, time of day, direction, from, to, caller ID name, result (`answered`, `missed`, `voicemail`, or `other`), the provider result, and duration in seconds. `nextCursor` continues the same filters. Summary groups each outside number with a count, weekdays, times of day, local hours, and first and last seen.

The account call log is requested first. If that user cannot read the company call log, the tool reads the JWT extension's own call log and says so. Recordings are not requested.

RingCentral requires the application permission **ReadCallLog**. ReadCallRecording is not required. If the tool returns `forbidden`, open the app that owns `RINGCENTRAL_CLIENT_ID` at https://developers.ringcentral.com/my-account.html#/applications, enable ReadCallLog, save, generate a new JWT for the same user, and replace `RINGCENTRAL_JWT` in Lovable Cloud. Do not paste the JWT into chat. Company-wide history also needs the user permission FullCompanyCallLog. Without it, the result stays on the extension that owns the main line.

One call scans at most 8 pages of up to 1000 records so it stays inside RingCentral's heavy rate group. A truncated result includes `nextCursor`.

`boltz_square_revenue`, `boltz_square_payments`, and `boltz_disputes` read stored Square data. They do not create payments or invoices, they do not submit dispute evidence, and they do not mark a lead Paid. A `read` scope still cannot mark Paid. `boltz_integration_health` includes `square.disputeAlert` for disputes due within 3 days. Setup and the webhook are in `docs/SQUARE.md`.

### Send

`botName`, `idempotencyKey`, and `text` are required, plus `phone`, `leadId`, or `threadId`. The idempotency key is 8–128 characters: letters, digits, `:`, `_`, `.`, `/`, `-`. The actor stored on the lead event is `bot:<botName>`.

A successful send, including a duplicate retry of a text that already went out, moves a lead from **New** to **Contacted**. The evidence is `outbound_sms` and the outbound message id. Later stages, including Paid, are not changed. If that lifecycle write fails, the SMS result still succeeds and the response includes a warning.

Optional profile fields (`email`, `name`, `leadSource`, vehicle fields, `service`, consent) are checked on their own. An invalid value is dropped, named in `warnings`, and does not reject the text. `anderson_darnell@ymail.com` is a valid address. Phone is dropped only when a lead id or thread id can still address the text.

The handler calls `handleBotRequest` (the bot API send action). That path still applies:

- opted out, or a latest inbound of STOP / UNSUBSCRIBE / CANCEL / END / QUIT: refused, no text
- banned wording and the 480-character cap
- thread, lead, or phone mismatch
- 20 outbound texts to that number in a rolling 24 hours
- a reused idempotency key on the same thread is a duplicate and does not text again

The shop previously had no server-side texting-hours rule (owner send and the bot API included). MCP sends add one: **8:00 AM through 8:59 PM America/Chicago**. 9:00 PM through 7:59 AM is refused and the send path is not called. A retry during quiet hours is refused too; call again inside the window and an already-sent key comes back as a duplicate.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "boltz_send_sms",
    "arguments": {
      "botName": "lead-follow-up",
      "phone": "+13125550100",
      "text": "Hi, this is Boltz Automotive. We can look at the car tomorrow morning. Reply STOP to opt out.",
      "idempotencyKey": "follow-up-example-1"
    }
  }
}
```

### Lead update

`leadId` plus `notes` and/or `lifecycle`. Stage names are case-insensitive: `contacted` and `Contacted` are the same stage. The canonical values are `New`, `Contacted`, `Qualified`, `Appointment Scheduled`, `Inspected`, `Estimate Sent`, `Approved`, `In Progress`, `Completed`, `Paid`, `Lost`, `No response`, `No-show`, `Duplicate`, `Spam`, and `Outside service capability`.

Lifecycle needs `evidence.basis`. After an outbound SMS, use `outbound_sms` and set `evidence.evidenceRef` to that message id. The message must be an outbound text on this lead and must not be `failed`. A successful `boltz_send_sms` already performs the New → Contacted move, so a second call is only needed when that automatic move did not apply.

Other bases remain `customer_message`, `staff_observation`, `appointment_record`, `inspection_record`, `estimate_record`, and `manual_correction`. Appointment Scheduled, Inspected, Estimate Sent, Approved, and Paid keep their existing evidence rules. The transition uses the staff rules (`staff:mcp:<agent name>`), so Paid is refused. A database failure returns `Lifecycle update failed:` plus the redacted reason, not a bare `request failed`.

Notes replace the field, 1–2000 characters, and the event stores the length, not the text.

Migration `supabase/migrations/20261014160000_contacted_after_bot_sms.sql` moves existing **New** leads to **Contacted** when a `bot:%` actor already recorded `outbound_sent` and a non-failed outbound message exists. Owner and staff texts are not changed. Apply it with the normal migration path. It is safe to run more than once.
