# Square

Read-only Square sync for Boltz Insight Engine. Completed payments, refunds, orders, invoices, customers, and catalog items land in Supabase. A completed payment that matches one lead by phone or email updates that lead's Square revenue and can mark the lead Paid. Nothing in this connector creates a Square payment or invoice.

The owner page is `/square`. Integration Health includes the same connection status. Both require `integrations.manage`.

## Secrets

Set these in Lovable Cloud secrets. Never put them in `VITE_` variables, chat, code, or logs.

| Name                           | Required           | What it is                                                                                                                                                      |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQUARE_ACCESS_TOKEN`          | yes                | Production access token. Sent only as `Authorization: Bearer`.                                                                                                  |
| `SQUARE_APPLICATION_ID`        | yes, for health    | Production application id (`sq0idp-…`). An identifier, not an auth secret. Shown on `/square` so you can confirm the app. Hidden if it equals the access token. |
| `SQUARE_ENVIRONMENT`           | no                 | `production` (default) or `sandbox`. Any other value leaves Square unconfigured.                                                                                |
| `SQUARE_LOCATION_ID`           | no                 | Pin one location. Leave unset to auto-discover.                                                                                                                 |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | no, until webhooks | Signature key for the webhook subscription. Until this is set, the webhook rejects every event.                                                                 |
| `PUBLIC_APP_URL`               | yes, for webhooks  | Already used by the app. The notification URL is this value, with no trailing slash, plus `/api/public/square/webhook`.                                         |
| `CRON_SECRET`                  | yes, for sync      | Existing cron bearer. `LOVABLE_CRON_SECRET` is also accepted.                                                                                                   |
| `SQUARE_BACKFILL_SINCE`        | no                 | Inclusive UTC `YYYY-MM-DD` used when a backfill request omits `since`. Not before `2010-01-01`, and not in the future.                                          |

`SQUARE_ACCESS_TOKEN` and `SQUARE_APPLICATION_ID` are already set, and they are production credentials. Do not create a second token for this connector.

## Square Developer app

Use the production application whose Application ID equals `SQUARE_APPLICATION_ID`.

Permissions (read scopes only):

- `PAYMENTS_READ`
- `ORDERS_READ`
- `INVOICES_READ`
- `CUSTOMERS_READ`
- `ITEMS_READ`
- `MERCHANT_PROFILE_READ` (List Locations)

This connector does not call CreatePayment, CreateInvoice, or any other write.

## Locations

`GET /v2/locations` runs on each sync and on the owner dashboard (cached for 60 seconds).

- `SQUARE_LOCATION_ID` set: that id is used, even if the list contains others.
- Exactly one `ACTIVE` location: that id is used. Inactive locations are ignored.
- Several `ACTIVE` locations: nothing is guessed. `/square` and Integration Health list each location id, status, and name. Payments are listed across locations. Orders and invoices are searched once per active location. Copy the shop location id into `SQUARE_LOCATION_ID` when you want a single pin.
- No `ACTIVE` location: order and invoice search is skipped. Payments are listed without a location filter.

## Webhook

After publish, the notification URL is exactly:

```text
https://boltz-insight-engine.lovable.app/api/public/square/webhook
```

That is `PUBLIC_APP_URL` plus `/api/public/square/webhook`. A trailing slash on the base is stripped. The signature is HMAC-SHA256 of `notification URL + raw body`, base64, in `x-square-hmacsha256-signature`. A different URL or a re-serialized body will not verify.

Subscribe these events on the production subscription:

- `payment.created`
- `payment.updated`
- `refund.created`
- `refund.updated`
- `invoice.created`
- `invoice.updated`
- `invoice.published`
- `invoice.payment_made`
- `invoice.canceled`
- `invoice.scheduled`
- `invoice.refunded`
- `order.created`
- `order.updated`
- `order.fulfillment.updated`
- `customer.created`
- `customer.updated`
- `customer.deleted`

### Signature key

`SQUARE_WEBHOOK_SIGNATURE_KEY` is not set yet. Until it is, `POST /api/public/square/webhook` returns **503** and does not store or apply the event. A bad signature is **403**. A duplicate event id that already finished is **200** `{ "ok": true, "duplicate": true }`.

To get the key:

1. Open [Square Developer Console](https://developer.squareup.com/apps).
2. Open the application whose Application ID matches `SQUARE_APPLICATION_ID` on `/square`.
3. Switch to **Production** (not Sandbox).
4. Open **Webhooks**, then the subscription whose notification URL is the URL above.
5. Copy the **Signature key**.
6. Save it in Lovable Cloud secrets as `SQUARE_WEBHOOK_SIGNATURE_KEY`.

Do not paste the key into chat, a commit, or a `VITE_` variable. The key is never shown in the UI. Only "configured" or "missing" is.

If `PUBLIC_APP_URL` is missing, the webhook also returns **503**, because the signature cannot be checked without the exact URL.

## Sync

`GET` or `POST` `/api/public/cron/square-sync` with `Authorization: Bearer <CRON_SECRET>`.

- `?mode=incremental` (default). Each resource starts 6 hours before its last `synced_through`, or 7 days back on the first run.
- `?mode=backfill&since=YYYY-MM-DD`, or `SQUARE_BACKFILL_SINCE` when `since` is omitted.

Missing `SQUARE_ACCESS_TOKEN` (or an invalid `SQUARE_ENVIRONMENT`) returns **503** `{ "configured": false }` and does not call Square. A thrown failure returns **500** `{ "error": "square-sync failed" }`. Logs keep error codes only.

Upserts are keyed on Square ids. A later event updates the same row. Card data stored is brand and last 4 only.

Schedule it the same way as the other app crons. Replace `CRON_SECRET` in the SQL editor with the existing secret. Do not commit that value.

```sql
select cron.schedule('square-sync-incremental', '15 * * * *', $$
  select net.http_post(
    url := 'https://boltz-insight-engine.lovable.app/api/public/cron/square-sync?mode=incremental',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);
```

One backfill, after the migration is applied:

```bash
curl -sS -X POST \
  "https://boltz-insight-engine.lovable.app/api/public/cron/square-sync?mode=backfill&since=2024-01-01" \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Matching and Paid

Phone numbers are reduced to a US 10-digit key (an 11-digit number starting with 1 drops the leading 1). Emails are lowercased. Stored Square customers keep phone and email for matching and do not keep names.

- One lead on the phone: `exact_phone`.
- No phone match, one lead on the email: `exact_email`.
- Phone and email point at different leads, or several candidates: `ambiguous`. The previous link is cleared.
- Otherwise: `unmatched`. A previous exact link is kept if a later payload has no contact fields.

Only payments mark Paid. Invoices, orders, and customers are linked and do not move lifecycle.

A payment marks Paid only when it is `COMPLETED`, the match is `exact_phone` or `exact_email`, and the lead is still in an open funnel stage (not already Paid, not a terminal stage such as Spam or Lost). The actor is `system` with `payment_record` evidence. Staff and MCP still cannot mark Paid. The owner path is unchanged: owner Paid is still Completed plus `payment_record`.

Terminal leads can still receive Square revenue totals when linked. Their lifecycle is not forced to Paid. A lead that is already Paid gets updated totals and stays Paid.

Refunds reduce net revenue. They do not automatically move a lead back from Paid. An owner reverses Paid from the existing lifecycle screen.

Unmatched and ambiguous payments stay on `/square` for review. That table shows time, Square id, status, amount, card brand, last 4, and match status. It does not show phone, email, or name.

## Revenue

Weekly buckets are Monday–Sunday in America/Chicago.

- Gross: completed payments created that week.
- Refunds: completed refunds created that week (a refund can land in a later week than the payment).
- Net: gross minus those refunds.
- Average ticket: gross divided by the completed-payment count, rounded down to the cent.
- Attributed: completed payment gross that has a lead, grouped by `lead_source`. A blank source is `unknown`.

`square_revenue_weekly` is a `security_invoker` view in cents. `anon` and `authenticated` cannot select it. The owner UI and the MCP/bot reads use the same rules and return cents.

`sales_weekly` is updated in dollars (`square_gross`, `square_net`, `square_refunds`, `square_avg_ticket`, and `square_attributed` values). `square_ticket_count` is a count. Existing `stripe_gross`, `notes`, and `reported_by` are left alone.

Lead columns `square_gross_cents`, `square_net_cents`, and `square_paid_at` are the linked completed-payment totals. Net on the lead subtracts refunds recorded on those payments, which is not the same cash-basis week as `sales_weekly`.

## Reads

MCP, `read` scope:

- `boltz_square_revenue` — `since` and `until` are optional YYYY-MM-DD week starts.
- `boltz_square_payments` — optional `leadId`, `limit` 1–50 (default 20).

Bot API (`X-Bot-Api-Secret`):

- `square_revenue`
- `square_payments`

See `docs/MCP.md` and `docs/bot-api.md`. Integration health for MCP uses the last sync row and does not call Square on each request. `/square` does call List Locations.

## Data

Migration: `supabase/migrations/20261009120000_square.sql`.

Tables: `square_sync_state`, `square_webhook_events`, `square_customers`, `square_payments`, `square_refunds`, `square_orders`, `square_order_line_items`, `square_invoices`, `square_catalog_items`.

RLS is enabled and forced. There are no policies. `anon` and `authenticated` have no grants. `service_role` is the only reader and writer. Webhook bodies are not stored. Logs and health rows hold ids, counts, and error codes.

Catalog sync stores item, item variation, and category id, type, name, `updated_at`, and `is_deleted`.

## Runbook

1. Apply `supabase/migrations/20261009120000_square.sql` in the Lovable SQL editor. This environment does not apply it.
2. Confirm `/square` shows the production application id and Connected. The access token is never displayed.
3. If the locations panel lists more than one active location, set `SQUARE_LOCATION_ID` to the shop id and run sync again.
4. Publish the app, then add the webhook subscription and `SQUARE_WEBHOOK_SIGNATURE_KEY` as above. Until the key is set, events stay rejected.
5. Run one backfill, then schedule the hourly incremental cron.
6. Check `/square` for last sync, the latest weeks, and unmatched payments.

Do not publish from an agent session. Publish after the migration is applied and the page looks right.
