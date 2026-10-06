# Bot API

Cookie-less read and SMS for shop bots. Staff inbox routes are unchanged and still require a signed-in staff JWT with `communications.send`. This route does not accept `CRON_SECRET`, a service-role key, or a browser session.

The handler is the app route `POST /api/public/bot`, same style as the cron routes. It calls the existing outbound path (`validateOutbound`, opt-out block, RingCentral send, `outbound_sent` lead event).

## Secret

Add this in Lovable Cloud secrets (server-side only, never in chat, code, or a `VITE_` variable):

- Name: `BOT_API_SECRET`
- Value: a long random string, different from `CRON_SECRET`

Send it only in the header `X-Bot-Api-Secret`. Integration Health shows the name as Configured or Missing and never the value.

Until the secret is set, the route returns **503**. A missing or wrong header returns **401**.

## URL

After a Lovable publish:

```text
POST https://boltz-insight-engine.lovable.app/api/public/bot
```

Publish is required. Pushing the branch updates the Lovable editor; the live site serves the route only after publish. No database migration is required.

## Send

`botName` is required. It is stored as the actor `bot:<botName>` on the `outbound_sent` lead event, with `bot_name` in the event metadata.

Start a thread by phone. A brand-new thread is set to human control so the in-app auto-reply does not also text. Replying to an existing thread leaves control mode as it is.

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/bot" \
  -H "Content-Type: application/json" \
  -H "X-Bot-Api-Secret: $BOT_API_SECRET" \
  -d '{
    "action": "send",
    "botName": "shop-inbox",
    "phone": "+17085550100",
    "name": "Alex Rivera",
    "email": "alex@example.com",
    "leadSource": "facebook_lead_ads_manual",
    "vehicleYear": 2014,
    "vehicleMake": "Ford",
    "vehicleModel": "Focus",
    "service": "engine misfire",
    "text": "Hi Alex, this is Boltz Automotive. We got your note about the 2014 Ford Focus misfire. Reply STOP to opt out.",
    "idempotencyKey": "alex-focus-first-touch"
  }'
```

Reply on a thread you already looked up:

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/bot" \
  -H "Content-Type: application/json" \
  -H "X-Bot-Api-Secret: $BOT_API_SECRET" \
  -d '{
    "action": "send",
    "botName": "shop-inbox",
    "leadId": "LEAD_UUID",
    "threadId": "THREAD_UUID",
    "phone": "+17085550100",
    "text": "We can inspect it tomorrow morning if you want to drop it off.",
    "idempotencyKey": "alex-focus-reply-2"
  }'
```

`phone` on a reply must match the lead. `leadSource` examples that pass the source check: `facebook_lead_ads_manual`, `yelp`.

Success:

```json
{ "ok": true, "duplicate": false, "reason": null, "leadId": "...", "threadId": "...", "messageId": "..." }
```

The same gates as owner send apply:

- `consent_status = opted_out`, or a latest inbound of STOP / UNSUBSCRIBE / CANCEL / END / QUIT, returns **403** `Lead has opted out of texts` and does not text.
- Banned wording and the 480-character cap use `validateOutbound`. A block is **422** and starts with `Blocked by outbound policy validation`.
- Thread/lead or phone mismatches return **409** with the same reasons as the inbox.
- There is no server-side business-hours block.

Idempotency:

- Pass `idempotencyKey` (8–128 characters: letters, digits, `:` `_` `.` `/` `-`). A retry of a key that already has a message row on that thread returns **200** `{ "ok": true, "duplicate": true }` and does not text again, even if the body changed. The same key on a different thread is **409**.
- With or without a key, the same body to the same number inside 10 minutes is also a duplicate.
- Serial retries are safe. Two overlapping in-flight requests can still both pass the check; send one, then retry.

Per-number cap: `BOT_DAILY_SMS_CAP_PER_NUMBER` in `src/server/lead-inbox/bot-api.policy.ts` (20 outbound texts on that thread in a rolling 24 hours). Over the cap is **429**. A duplicate retry is still **200**, not **429**.

## Read

Lookup by phone or email (one of them):

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/bot" \
  -H "Content-Type: application/json" \
  -H "X-Bot-Api-Secret: $BOT_API_SECRET" \
  -d '{"action":"lookup","phone":"+17085550100"}'
```

```json
{
  "found": true,
  "matchCount": 1,
  "lead": {
    "id": "...",
    "name": "Alex Rivera",
    "phone": "+17085550100",
    "email": "alex@example.com",
    "consentStatus": "unknown",
    "lifecycle": "New",
    "leadSource": "facebook_lead_ads_manual",
    "vehicleYear": 2014,
    "vehicleMake": "Ford",
    "vehicleModel": "Focus",
    "service": "engine misfire",
    "lastInboundAt": null,
    "lastOutboundAt": null,
    "lastMessageAt": null
  },
  "thread": { "id": "...", "phone": "+17085550100", "controlMode": "human", "lastMessageAt": null }
}
```

`found: false` is **200**. If several leads share an email, `matchCount` is the total and `lead` is the most recently active one.

Recent messages (inbound and outbound), oldest first within the latest `limit`:

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/bot" \
  -H "Content-Type: application/json" \
  -H "X-Bot-Api-Secret: $BOT_API_SECRET" \
  -d '{"action":"messages","leadId":"LEAD_UUID","limit":40}'
```

`phone` or `threadId` works in place of `leadId`. Each message has `id`, `direction`, `body`, `createdAt`, `status`, `providerCreatedAt`.

Inbound since a timestamp (exclusive), up to 30 days back:

```bash
curl -sS -X POST "https://boltz-insight-engine.lovable.app/api/public/bot" \
  -H "Content-Type: application/json" \
  -H "X-Bot-Api-Secret: $BOT_API_SECRET" \
  -d '{"action":"inbound","since":"2026-10-06T14:00:00Z","limit":50}'
```

Each row has `id`, `leadId`, `threadId`, `body`, `createdAt`, `from`, `status`. `truncated: true` means the limit cut off more rows; call again with the last `createdAt`.
