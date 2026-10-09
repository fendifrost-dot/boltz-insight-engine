# Boltz shop desk

`/desk` is the receptionist entrance. It has three destinations: Front desk, Find a customer, and Grok chat. The separate operations console remains available to owners through Manage shop. The desk uses the Boltz logo from the existing public website, yellow/black/white brand colors, customer cards, and plain-language display labels. Stored lead-source and lifecycle values are unchanged.

The moon/sun button in the top bar switches the entire desk between light and dark mode, including intake and Grok chat. Light remains the initial default. The choice is stored in `boltz:desk-theme` in that browser, persists across desk navigation and reloads, and synchronizes between tabs on the same device. Each shop iPhone and computer can choose independently. If browser storage is unavailable, the toggle still works for the current visit. Owner-console styling is unchanged.

Walk-in and phone intake continue through `createDeskLead`: canonical `leads`, phone duplicate checks, retry keys, Google call attribution, notes, and Square matching. For a repeat phone number, the entered conversation is offered as a note on the existing customer. Notes, texts, source correction, progress changes, payments and history remain available on the customer card. No customer SMS is sent by saving a lead or using internal chat.

## Chat on the existing agent connections

The instant assistant uses the existing `XAI_API_KEY`, model resolution, and Grok server adapter. Its tools only read customers, customer texts, and dated shop visits under the staff member's authenticated Supabase client and existing RLS. It cannot send customer SMS or mutate customers. Chat is a shared shop room, not a private personal conversation.

`desk_chat_messages` is only the internal conversation log; it does not duplicate customer or SMS records. Browser roles cannot insert or impersonate agent messages. Server functions require staff capabilities. Supabase Realtime delivers new messages, with foreground polling as a fallback. “Live chat” means the room is connected, not that a desktop agent is online. Failed instant replies are clearly marked as unavailable and the staff question remains saved.

The existing `/api/public/mcp` endpoint now advertises:

| Tool | Existing scope | Purpose |
| --- | --- | --- |
| `boltz_shop_chat` | `read` | Read latest messages, or messages after a sequence cursor. |
| `boltz_post_shop_message` | `leads.write` | Ask/reply to the shop. No customer SMS. |
| `boltz_shop_schedule` | `read` | Confirmed visits for a Chicago date, default today. |

Grok Bot/Muse use their already-authorized credentials. Refresh tool discovery after publishing. No credentials or new agents are created by this change. There is no evidence that deploying the desk automatically starts a desktop listener; that listener must be active in the agent runtime to claim unattended two-way monitoring.

Agent behavior:

1. Read `boltz_shop_chat` with `{ "limit": 60 }` to establish context. Persist `nextCursor` in the existing agent runtime.
2. While assigned to the shop desk, read `{ "after": <cursor>, "limit": 100 }` every few seconds. Continue immediately while `hasMore`. Advance the cursor only after processing the returned messages. Avoid duplicate answers where the instant assistant already resolved the question.
3. Reply with `boltz_post_shop_message`: `{ "text": "…", "idempotencyKey": "<UUID>", "replyTo": "<message UUID>" }`. Add `leadId` when discussing one customer; the receptionist gets a link to their card. Reuse the same key on retries. The sender is derived from the authenticated agent.
4. To ask a new question of reception, omit `replyTo`. Staff can reply in the same room. Keep instructions and answers specific to Boltz; never claim work completed without evidence.

The existing Bot API also accepts `shop_chat`, `shop_message`, and `shop_schedule` actions with the same arguments and its existing `X-Bot-Api-Secret` authentication. `shop_message` requires the existing validated `botName`. MCP is preferred when available because its identity and scope audit are stronger.

## Confirmed visits

`leads.appointment_at` holds the next confirmed visit on the existing customer, entered/displayed in America/Chicago. It is separate from `appointment_interest`. A lifecycle label with no date is reported as undated and is never counted as today’s booking. This does not claim to sync an external calendar or ALLDATA schedule.

The visit date and history event save together in `set_desk_appointment`. A stale edit is rejected and repeats do not duplicate history. Cancellation clears the date; if the customer was at Appointment Scheduled, the existing lifecycle function returns them one stage to Qualified and records the change. Other stages stay unchanged. Direct browser changes to appointment dates are blocked. DST gaps and ambiguous fall-back times are rejected instead of guessed.

Deploy migrations `20261009203000_desk_chat_and_visits.sql` and `20261009204500_desk_visit_cancellation.sql` before publishing the app. The cancellation function depends on the existing `20260828013000_apply_lead_lifecycle_transition.sql`; that previously missing function was also applied to production during this rollout. No new model credentials are needed. Verification includes a production-schema transaction that rolls back all fixtures, checking chat grants, idempotency, visit history, stale edits, cancellation, and lifecycle preservation, plus unit/MCP authorization tests and the production build.
