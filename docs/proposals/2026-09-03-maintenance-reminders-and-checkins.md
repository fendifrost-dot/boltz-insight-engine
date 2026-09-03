# PROPOSAL — Monthly maintenance reminders and post-service check-ins

**Status: waiting for owner sign-off. This is not a live sending system.**

Nothing in this pull request texts a customer. There is no monthly job turned on, no Square token wired, and no path that can call the shop’s RingCentral send function. The goal of this document is for Fendi (Boltz Automotive) to review the mechanism and say yes, no, or change these parts before anyone builds it.

Shop this is for: Boltz Automotive, 707 W. 119th St., Chicago, IL 60628, shop line (708) 575-4555. Live app today: [boltz-insight-engine.lovable.app](https://boltz-insight-engine.lovable.app).

---

## 1. What you would get, in plain language

Two separate flows, both using the **same texting path the Lead Inbox already uses**. Never the RingCentral web UI.

### A. Monthly maintenance reminders

Once a month the system would pull fresh paid work from Square, figure out who is coming due for oil / brakes / battery / transmission fluid, and put each person on a **dated send list** (“this reminder, to this person, on this date”). You would see that list on a screen, edit it, and cancel anyone who should not get a text. On the scheduled day, during shop hours, the system would send **one combined text** per person.

Cadence you asked for: first text when they are due, one follow-up 14 days later if they stay silent, then stop.

### B. Post-service check-in

A few days after paid work, a short “how’s the car holding up?” text. If they say it is still wrong or they are unhappy, it goes to a human on the Escalations screen and **never** asks them for a public review. If they are fine, we can mention other work in the same short text — not as a sales blast.

### The review-link ask, answered up front

**A single smart link that posts a review to both Google and Yelp does not exist**, and building a “only ask happy people” review funnel would violate both platforms’ rules. Yelp’s own business guidance is “don’t ask for reviews.” Google allows a genuine ask but forbids screening customers first and only sending the happy ones to the public form.

**Recommended V1:** check-in only. No Yelp link. No automatic Google review ask. Unhappy replies go to you. If you later want Google reviews, we can add a **separate, equal ask to everyone** who had recent work — not a happiness filter. Details in [section 9](#9-check-ins-and-reviews--honest-policy-answer).

---

## 2. The two design calls that matter most

### Use a due-date list in our database, not Google Calendar

You described “maybe a calendar” as the way to organize “this reminder should go to this person on this date.” That intent is right. **Literal Google Calendar events are the wrong tool.**

A database send queue is better because:

1. **Duplicates can be made structurally impossible.** A unique rule in the database can say “this person + this reminder reason + this past job can exist only once.” Google Calendar has no such rule. Two syncs, a retry, or a redeploy can create two events and two texts.
2. **The send list can be edited before anything goes out.** You can cancel, move a date, or combine reasons on a screen we own. Calendar events are clumsy for that and easy to duplicate by hand.
3. **Consent and shop hours are checked at send time**, not when the row is created. A calendar reminder would fire even if the customer texted STOP yesterday or it is Sunday.
4. **We already have a job runner** (the same cron that drains Lead Inbox work). A queue table plugs into that. Google Calendar would be a second integration that can silently fail.
5. **You still get a calendar view.** The admin screen can look like a month of upcoming texts. That is a view of the queue, not a second source of truth.

**Recommendation:** a `outreach_queue` table with a scheduled date, shown as a calendar-like list in the app. Do not create Google Calendar events to trigger sends.

### Pull Square through the API every month, not a CSV upload

Your hand export is split in a way that makes automation painful: the invoice list has names and phones but **no line items**; the itemization export has services and notes but **no phone**; itemization only goes back 12 months. A person uploading two CSVs and joining them by name every month **will eventually skip a month**.

Square’s APIs can join what the CSVs split:

| Square API | What it gives us |
| --- | --- |
| **Orders** (`SearchOrders`) | Line items, item notes, dates, `customer_id`. This is the itemization, without the 1-year report cap. |
| **Customers** | Phone, email, name, company name for that `customer_id`. |
| **Invoices** | Paid / unpaid status and a snapshot of the recipient phone. |
| **Catalog** (optional) | Official item categories, useful later for cleaner mapping. |

**Recommendation:** store a Square access token as a Lovable Cloud server secret (same place RingCentral and Grok keys already live). A monthly job copies paid orders + customers into **our** tables. After that, due dates are computed from our copy. We are not rescanning all of Square history every hour.

**CSV upload stays as a one-time backfill / emergency fallback**, not the monthly habit. If the API is missing older notes, we can import the export you already made once, then let the API take over.

**Tradeoffs, stated plainly:**

| | Square API (recommended) | Monthly CSV upload |
| --- | --- | --- |
| Phones + line items together | Yes, via Orders + Customers | You must join two files by name; names collide |
| History window | No 1-year report cap | Itemization capped at 12 months |
| Will it actually run every month? | Yes, if the job is healthy | Easy to skip when the shop is busy |
| Setup | Create a Square app, paste a token into Lovable secrets | Build an upload screen; you do the export |
| Risk | Token expires / API gaps on very old tickets | Silent “we forgot to upload” and bad name matches |
| Cost | Square API is free for the merchant’s own data | Your time |

We should still design the first monthly pull as **incremental** (new/updated since the last successful watermark) plus a one-time historical backfill. That matches your “pre-pull the people who will be due” requirement: after the monthly run, the due list already exists. Day-to-day sending only reads the queue.

---

## 3. What already exists that we should reuse

This repo already texts customers. We should not build a second SMS stack.

| Piece | Where it lives today | How reminders / check-ins would use it |
| --- | --- | --- |
| **Outbound SMS** | `sendOutbound()` in `src/server/lead-inbox/outbound.server.ts` | Only send path. Same RingCentral shop line. Same length and “no fake promises” checks. |
| **Idempotent message insert** | `messages.idempotency_key` unique index | Every outreach text gets a key like `outreach:{queue-row-id}:initial`. A retry cannot insert a second message. |
| **Consent** | `leads.consent_status` = `unknown` / `opted_in` / `opted_out` | Send only if `opted_in`. `unknown` and `opted_out` stay on the list as **blocked**, not sent. |
| **STOP / START** | `safety.server.ts` + inbound job | STOP already sets `opted_out` and sends the unsubscribe confirmation. Mid-queue STOP is caught at send time. |
| **Human takeover** | `message_threads.control_mode` = `auto` / `human` | Skip anyone in human mode (you are already talking to them). |
| **Lead identity** | `leads.phone_e164` unique | One phone = one person we can text. Vehicle year/make/model already sit on the lead. |
| **Job queue** | `message_jobs` with lease claiming, retries, dead letter | Daily sender claims due queue rows; same runaway protection. |
| **Cron** | `POST /api/public/cron/*` + `CRON_SECRET` (pg_cron / pg_net) | Add two new cron routes later: monthly Square sync, weekday daytime drain. **Not created in this PR.** |
| **Inbound parsing / Grok** | webhook → `process_inbound` → safety rules → Grok | Replies to a check-in or reminder stay in the existing thread. Negative / “still broken” opens an **Escalation** and flips the thread to human. |
| **Escalations screen** | `/escalations` | Unhappy check-ins land here. |
| **Owner compose** | `/leads` + `startOwnerSms` / `sendOwnerMessage` | Fallback if you want to send a one-off yourself. |
| **Health** | `/integration-health` + `integration_health_snapshots` | Sync failures and “queue has not fired” alarms go here. |
| **Consent evidence** | `existing_business_relationship` is already a valid basis when **you** mark someone opted in | Square history alone does not flip consent. You (or a later approved rule) mark it. |

**What does not exist today**

- No Square tables, token, or sync.
- No customer / vehicle tables beyond the fields on `leads`.
- No shop appointment calendar in this app (there is an `appointments.manage` permission name, but no appointments table).
- No “Reply STOP to opt out” enforcement on the first text of a brand-new thread (the Lead Inbox agent is inbound-reply only; this rule must be added for unsolicited outreach).
- No Google Calendar connection in the app.
- Context Lock still says “do not solicit reviews.” An automatic Google ask would need you to unfreeze that on purpose.

---

## 4. How a person gets onto the send list

```
Square (monthly) → our invoice + line-item tables
        → classify each line (service + vehicle, or "needs a human")
        → apply exclusions (body, insurance, deposit-only, fleet, …)
        → compute due date from the last real service date
        → write a due-item row (unique per person + reason + that past job)
        → bundle the same person's due items into ONE queue row with a send date
        → you review the queue
        → on that date, during 9–5 Mon–Sat Chicago time, send-time checks run
        → sendOutbound() once, or skip and say why
```

### Service intervals (V1 only)

Time-based, not mileage. Chicago severe service. V1 ships **only** these four:

| Reminder | Due after | Example |
| --- | --- | --- |
| Engine oil | 5 months | Oil on Jan 15 → first text around Jun 15 |
| Brake inspection | 12 months after a pad/rotor job | |
| Battery test | 24 months | |
| Transmission fluid | 24 months | |

Held for later (already in your working list, not V1): tire rotation, alignment, coolant, brake fluid, cabin/engine air filters.

If two things are due for the same phone, they become **one text**, not two. Example: “oil and a battery test are due on your 2012 Chevy Equinox.”

### Send date

- First reminder: the due date, then **snap forward** into the next legal send window (Mon–Sat, 9:00 AM–5:00 PM America/Chicago). Never Sunday. Never 8 AM. Never after 5.
- Follow-up: 14 days after the first text actually went out (not 14 days after due), then snap into the window. If they reply to the first text, no bump.
- Check-in: **3 days after the invoice is paid**, then snap into the window. Far enough that the car has been driven; close enough that “how’s it holding up?” still makes sense.

Appointment windows we would offer in the text (weekdays only): 9–11, 11–1, 1–3, 2–4. Never 8 AM. Saturday can receive texts; we do not offer Saturday appointment blocks unless you say otherwise (open question below).

---

## 5. How we make “the same reminder twice” impossible — not merely unlikely

This is the hard requirement. Retries, redeploys, and a second monthly sync must not create a second text.

We split “the fact that they are due” from “the text we might send.”

### Table 1 — due items (the facts)

One row = “this phone needs this reminder because of this past Square job on this vehicle.”

**Unique rule that prevents duplicate facts:**

```
UNIQUE (phone_e164, reminder_kind, source_order_id, vehicle_key)
```

- Same oil change imported twice (retry, overlapping months) → second insert is rejected. We keep the first row.
- A **new** oil change six months later has a different `source_order_id` → a new due item is allowed. That is a new cycle, not a duplicate.
- Two vehicles on one phone → two due items, later bundled into one text.

### Table 2 — send queue (the dated texts)

One row = “this phone should get this kind of text (maintenance or check-in) on this date,” with the bundled reasons stored on the row.

**Unique rule that prevents duplicate texts:**

```
UNIQUE (phone_e164, campaign_kind, wave, bundle_key)
```

- `campaign_kind` is `maintenance` or `check_in` (never mixed on one row).
- `wave` is `initial` or `bump`.
- `bundle_key` is a stable hash of the due-item ids in that text.

The 14-day bump is a **second wave** on the same bundle, created only after the first text is recorded as sent and no inbound reply has arrived. It cannot be created twice.

**One text per person per day** (maintenance and check-in cannot share a day):

```
UNIQUE (phone_e164, scheduled_local_date)
  WHERE status IN ('approved', 'sending', 'sent')
```

If both are due the same day: **check-in wins** (it is closer to the job). The maintenance row moves to the next legal day.

### At the moment of send (this is where consent and hours are enforced)

Creating a queue row does **not** mean it will send. The daily job, right before `sendOutbound()`:

1. Claim the row: `UPDATE … SET status = 'sending' WHERE id = ? AND status = 'approved' AND sent_at IS NULL`. If zero rows update, another worker already claimed it. Stop.
2. Re-read **right now**: consent is `opted_in`, thread is not `human`, phone still exists, it is Mon–Sat 9–5 Chicago, this phone has no other outbound today, feature flag is on.
3. If any check fails: set `skipped` or `blocked` with a reason. **Do not send.**
4. If this is the first outbound on that thread, append `Reply STOP to opt out.`
5. Call `sendOutbound()` with `idempotency_key = outreach:{queue_id}:{wave}`.
6. The `messages` table already refuses a second insert with that key. If the job crashes after RingCentral accepts the SMS but before we mark the queue `sent`, the retry sees the existing message and marks the queue sent without sending again.

That stack — unique due item, unique queue row, claim-before-send, unique message key — is what makes a double send a database error instead of a customer complaint.

---

## 6. Who we will not text

Checked when we build the due list **and again at send time**.

| Rule | How |
| --- | --- |
| Not `opted_in` | Queue row exists, status `blocked_consent`. You can see them. They do not send. |
| `opted_out` / STOP | Same. If they STOP after being queued, send-time check cancels remaining waves. |
| Thread in human mode | Skip. You are already handling it. |
| Body / collision / paint | Line or invoice flagged exclude. If mixed with mechanical work, **human review** (do not guess). |
| Insurance claim / deductible-only | Exclude. |
| Deposit-only / balance-only | Exclude. Those are payments, not services. |
| Diagnostic-only | Exclude. |
| Fleet / commercial | Exclude when Square `company_name` is set or the name matches an owner-maintained list. |
| No usable phone | Cannot text. Parks in the “needs a human” list. |
| Parser cannot classify the line | Parks for you. **Never silently dropped.** |
| Upcoming appointment | V1: you cancel them on the queue. V2: skip if we have a real shop calendar. |

Identity rules (Square is messy here):

- **Phone is who we text.** Same name, two phones = two people. We will not merge them by name.
- **Same phone, two names on invoices** = one thread. We keep the extra names as aliases.
- **No phone** = review list, no text.
- **Two vehicles, one phone** = one text that names both if needed.

---

## 7. How we read messy Square line items

Vehicle and service can sit in **either** the item name or the note, swapped. Real examples from your export:

| Item | Note | What the parser should see |
| --- | --- | --- |
| Oil change | 2012 Chevy equinox LT | Oil + 2012 Chevrolet Equinox |
| 2015 Chrysler 200 | Engine mounts / Trans mount / Oil change | Oil + 2015 Chrysler 200 (mounts are not a V1 reminder) |
| Starter & oil change | 2014 Audi Q5 | Oil + 2014 Audi Q5 |
| Custom Amount / Balance / Deposit / Diagnostic | (anything) | Not a service. Exclude or review. |

Rules:

1. Concatenate item name + note. Search **both**.
2. V1 service keywords (oil, brake pad/rotor, battery, trans fluid / ATF). Conservative: if it might be oil **or** might be something else, send it to review.
3. Vehicle: a year (1980–current+1) plus a known make, then the following words as model.
4. Exclusion keywords win for deposit / balance / deductible / insurance / collision / paint / diagnostic-only.
5. Anything left over goes to **`square_line_reviews`** for you to mark: keep as a service, exclude, or attach a vehicle. Those rows stay visible until you act. They are never deleted by the sync.

This PR includes a **gated-off classifier sketch** with those three real examples as tests, so you can see the rules before we wire Square.

---

## 8. Day-to-day: what fires the sends

After you sign off and we build it (not this PR):

1. **Monthly (e.g. 1st, 6:00 AM Chicago):** Square sync → classify → refresh due items → upsert queue rows for the coming month. Writes a health snapshot: orders scanned, new dues, review-queue count, errors.
2. **Weekdays and Saturday, every 15 minutes between 9 and 5 Chicago:** drain job looks at `outreach_queue` where `scheduled_local_date` is today, status is `approved`, and `run_after` is due. Runs the send-time checks. Sends or skips.
3. **You, anytime:** admin screen at a new `/outreach` page (not built yet). See this week, this month, blocked, needs-review. Edit date, cancel, or hold. No text leaves without an `approved` row and a live flag.

**Send-time vs queue-time, again:** a row created on the 1st for a send on the 20th can become invalid on the 19th (STOP, you took over the thread, they booked, they already got a check-in). The 20th job must re-check. The 1st job must not “lock in” a send.

---

## 9. Check-ins and reviews — honest policy answer

### Can one smart link post to Google and Yelp?

**No.** There is no official URL that files a review on both. Third-party “smart links” almost always ask “how did we do?” and then send only the happy answers to the public form. That is **review gating**.

### What Yelp allows

Yelp’s official business guidance, [Don’t Ask for Reviews](https://biz.yelp.com/support-center/Reviews/Best_Practices/Don-t-Ask-for-Reviews/en-US):

> Don’t ask anyone to review your business, be it customers, mailing list subscribers, friends, family, etc.

They also prohibit **review gating** (survey first, only send satisfied people to Yelp). Asking in a text, even if we asked everyone equally, is still asking. Enforcement can include Consumer Alerts on the listing and advertising bans.

Boltz currently has a leftover C&J Yelp listing problem (low rating, old name) documented in this repo. **That does not make asking allowed.** It makes a Yelp ask riskier.

**Verdict: we will not text a Yelp review link.** Prioritizing Yelp because there are fewer reviews there is understandable and still a terms violation if we ask.

### What Google allows

Google’s Maps user-generated content policy ([Prohibited & restricted content](https://support.google.com/contributionpolicy/answer/7400114?hl=en)) **does** allow merchants to ask for a genuine review. It **does not** allow:

- Incentives (discounts, free work) for a review or to change/remove one
- Asking people to mention keywords or staff names (this repo already forbids that)
- Pressuring people to review on the premises
- **“Discourage or prohibit negative reviews, or selectively solicit positive reviews from customers”**

A Place ID link is real and allowed as the destination when you ask everyone equally:

`https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID`

We do not yet store Boltz’s Place ID in this app. That would be a one-time lookup if you later approve a Google ask.

### The flow you described, measured against those rules

“Read the reply; if positive, push a review; if negative, do not ask and route to a human.”

- Routing unhappy people to a human: **good, and we should do that.**
- Only sending a review link after a positive reply: **that is selective solicitation / gating.** Google forbids it. Yelp forbids it. The FTC has also treated gating as a problem when it hides negative experiences.

**We will not build that funnel.**

### Compliant check-in we recommend

One short text, from “Boltz Automotive” / “we,” with the name and vehicle:

> Hey Tony Williams — thanks for choosing Boltz. How’s your 2002 Hyundai Sonata holding up? If you need anything else on it, text us here.

Then:

| Their reply | What happens |
| --- | --- |
| Positive / “it’s fine” | Human or a single optional “glad to hear it.” **No review link in V1.** |
| Negative / still broken / unsafe | Escalation, thread → human, **no review ask. Ever.** |
| “I need brakes” / other work | Stay in the existing Lead Inbox agent or human. One conversation, not a campaign. |
| STOP | Opt out. Queue cancelled. |

If you later want Google reviews, the compliant add-on is a **separate equal ask** to the whole recent-work group (consent permitting), same link for everyone, no happiness filter — and still no Yelp. That would also require lifting the Context Lock line “Do not solicit reviews.” Default until you say so: **do not auto-ask.**

---

## 10. Failure modes we would worry about

| What can go wrong | How we design against it |
| --- | --- |
| **Retry or redeploy sends twice** | Unique due item + unique queue row + claim `approved → sending` + `messages.idempotency_key`. Residual risk: RingCentral accepts the SMS, we crash before recording it, and RingCentral has no idempotency key on the current send helper. Mitigation: treat “message already recorded for this key” as success; consider adding a RingCentral client request id in the build phase. |
| **Same name, two households** | Never key identity on name. Phone only. |
| **Two vehicles, one phone** | Two due items, one bundled text. |
| **STOP while they are still on the queue** | Send-time consent check. Remaining waves for that phone → `cancelled_opt_out`. |
| **Monthly sync half-fails** | Watermark (`square_sync_runs`) only advances after a complete successful page loop. Partial run leaves the old watermark, retries the same window, unique keys drop duplicates. Failed run writes `ok=false` on integration health. |
| **Clock / DST / 9–5 bugs** | All window math in `America/Chicago`, not UTC. 9:00 AM CST and 9:00 AM CDT are both “9 AM Chicago.” Unit-test a spring-forward and a fall-back date. Never use “UTC hour 14–22.” |
| **Queue silently stops** | Health check: if there are `approved` rows with `scheduled_local_date` in the past and no successful drain snapshot today, `/integration-health` shows red and (later) you get an owner alert. Dead jobs already exist in `message_jobs`. |
| **`unknown` consent looks like a bug** | Most Square customers will start as `unknown`. They appear as blocked, not as sent. You decide who to mark opted in. We do not silently treat “they paid us” as SMS consent. |
| **Parser marks oil as “Custom Amount”** | Those lines go to review, not to the send list. You will see a count after each monthly pull. |
| **You take over a thread** | `control_mode=human` skips outreach so the bot does not talk over you. |
| **Check-in and oil reminder the same day** | Unique (phone, date) plus “check-in wins, maintenance moves.” |

---

## 11. Build order (smallest useful first)

Nothing below is in this PR except the written plan and inert sketches.

| Phase | What you can do with it | Sends texts? |
| --- | --- | --- |
| **V1a — See who is due** | Square token + monthly (or button) sync, parser, review list for messy lines, due list on a screen. You can still text people yourself from the Lead Inbox. | No |
| **V1b — Dated queue you can edit** | Each due person gets a scheduled date and reason. Cancel / move / hold. One-text-per-day and bundling visible. | No |
| **V1c — Gated sender** | Daily drain, send-time checks, STOP language, health alarm. Flag off until you flip it. First live week: you approve each day’s list. | Only after you flip the send flag |
| **V1d — 14-day bump** | Second wave only if silent. | Same flag |
| **V2 — Check-in** | 3-day post-pay text, sentiment → escalation, no review link. Same send window and daily cap. | Separate check-in flag |
| **Later** | Tire/alignment/filters; appointment-calendar skip; optional **equal** Google ask (never Yelp); Catalog-based categories; fleet list editor. | Only if you ask |

**V1 should include:** oil, brakes, battery, transmission fluid; Square API sync; human review for unclassified lines; due + queue tables; admin screen; send-time consent/hours/human-mode; duplicate constraints; health alarm. **V1 should wait on:** Yelp, gated review funnel, Google Calendar triggers, automatic consent from Square, Saturday appointment offers, mileage, and auto-asking for reviews.

---

## 12. Decisions we need from you

Each item has a recommended default. Reply with changes and we will lock them before any sending code is written.

| # | Question | Recommended default |
| --- | --- | --- |
| 1 | Database queue with a calendar-like screen, not Google Calendar events? | **Yes, database queue.** |
| 2 | Monthly Square API sync, CSV only for one-time backfill? | **Yes, API.** You will need to create a Square app and paste an access token into Lovable secrets (we never put it in the database or the browser). |
| 3 | V1 services = oil, brakes, battery, trans fluid only? | **Yes.** |
| 4 | Check-in delay after paid? | **3 days**, then next 9–5 Mon–Sat window. |
| 5 | If a check-in and a maintenance text land on the same day? | **Check-in that day; maintenance the next legal day.** |
| 6 | Review links in V1? | **None.** No Yelp ever via SMS. Google only later, as an equal ask, if you unfreeze Context Lock. |
| 7 | How do historical Square customers become `opted_in`? | **You mark them** (the app already supports “existing business relationship” as a written basis). We do not auto-opt-in from an invoice. |
| 8 | Where does the shop calendar live today (Google, Square Appointments, book, something else)? | **V1: you cancel people on the queue.** Tell us the calendar and we can skip them automatically later. |
| 9 | Offer Saturday appointment blocks in the text? | **No.** Texts may go Sat 9–5; offers stay weekday 9–11 / 11–1 / 1–3 / 2–4. |
| 10 | First live week: approve each day’s list before send? | **Yes.** After a quiet week, we can switch to “approved by default, you cancel.” |
| 11 | Fleet / commercial exclusion list — who is on it? | Start with any Square profile that has a `company_name`, plus names you add. Send us names you already know. |
| 12 | May we use Grok to classify a **reply** as happy vs “still broken,” with a keyword backstop so “still leaking / not fixed / worse” always escalates? | **Yes**, same model the inbox already uses. The review link is still not sent. |

---

## Appendix A — Existing system inventory (for whoever builds this later)

**Lead-inbox tables (production):** `leads`, `lead_events`, `message_threads`, `messages`, `message_jobs`, `agent_runs`, `escalations`, `ringcentral_subscriptions`, `integration_health_snapshots`.

**Enums that matter:** `consent_status` (`unknown`, `opted_in`, `opted_out`); `thread_control_mode` (`auto`, `human`); `message_job_type` (`process_inbound`, `send_outbound`, `reconcile`, `renew_subscription`).

**Secrets already in Lovable Cloud:** `RINGCENTRAL_*`, `XAI_API_KEY`, `XAI_MODEL`, `CRON_SECRET` / `LOVABLE_CRON_SECRET`, `PUBLIC_APP_URL`. New secret later: `SQUARE_ACCESS_TOKEN` (and `SQUARE_ENVIRONMENT` / `SQUARE_LOCATION_ID` if needed). Same `readSecret()` pattern as `src/server/lead-inbox/env.server.ts`. Never `VITE_`.

**Cron today:** `process-jobs` (drain), `reconcile-messages` (missed webhooks), `renew-subscriptions` (RingCentral webhook). Auth: `Authorization: Bearer CRON_SECRET`.

**STOP keywords today:** `stop`, `stopall`, `unsubscribe`, `cancel`, `end`, `quit` (exact message after normalize). Opt-in: `start`, `unstop`, `yes please text me`.

**Capabilities already named:** `communications.send`, `appointments.manage`, `integrations.manage`. Outreach admin should require staff; flipping the live send flag should require owner.

---

## Appendix B — Proposed data model (not applied)

This SQL is also copied to `docs/schema/proposed-customer-outreach.sql`. It is **not** a Supabase migration and will not run on production because of this PR.

```text
square_sync_runs
  id, started_at, finished_at, ok, watermark_updated_at, orders_seen, error
  -- watermark only moves when ok = true

square_customers
  square_customer_id PK, given_name, family_name, company_name,
  phone_e164, email, raw_updated_at

square_orders
  square_order_id PK, square_customer_id, closed_at, state,
  invoice_id, total_cents, source

square_order_lines
  id PK
  square_order_id, line_uid
  item_name, note, category, quantity
  parse_status: classified | excluded | needs_review
  reminder_kind: oil | brakes | battery | trans_fluid | none
  vehicle_year, vehicle_make, vehicle_model, vehicle_key
  exclude_reason
  UNIQUE (square_order_id, line_uid)

square_line_reviews
  id PK, square_order_line_id UNIQUE
  item_name, note, suggested_kind, suggested_vehicle
  resolution: pending | keep | exclude | attach_vehicle
  resolved_by, resolved_at
  -- human queue; sync never deletes pending rows

service_due_items
  id PK
  phone_e164, lead_id NULL
  reminder_kind
  vehicle_key, vehicle_label
  source_order_id, source_line_id
  service_on (date), due_on (date)
  UNIQUE (phone_e164, reminder_kind, source_order_id, vehicle_key)

outreach_queue
  id PK
  phone_e164, lead_id NULL, thread_id NULL
  campaign_kind: maintenance | check_in
  wave: initial | bump
  bundle_key
  due_item_ids uuid[]
  reasons text[]          -- what we will say we are reminding them about
  scheduled_local_date    -- America/Chicago calendar date
  run_after timestamptz   -- instant the window opens that day
  status: draft | approved | sending | sent | skipped | blocked_consent
          | cancelled | cancelled_opt_out | failed
  skip_reason, body_preview
  sent_at, message_id
  UNIQUE (phone_e164, campaign_kind, wave, bundle_key)
  UNIQUE (phone_e164, scheduled_local_date)
    WHERE status IN ('approved', 'sending', 'sent')

outreach_events  -- append-only, same idea as lead_events
  queue_id, event_type, actor, summary, metadata
```

Token location: **Lovable Cloud secret `SQUARE_ACCESS_TOKEN`**, read only on the server. Not a column. Not in git.

---

## Appendix C — Send-time checklist (must all pass)

Copied here so it cannot get lost in a later build:

1. Feature flags: `CUSTOMER_OUTREACH_ENABLED` and `CUSTOMER_OUTREACH_SEND_ENABLED` are true. If not, refuse.
2. Queue row claimed `approved → sending` (one winner).
3. `leads.consent_status = opted_in` on a fresh read.
4. `message_threads.control_mode = auto` (or no thread yet).
5. Now is Monday–Saturday, 09:00–17:00 `America/Chicago`.
6. No other outbound SMS to this phone since local midnight.
7. No other `outreach_queue` row for this phone in `sending`/`sent` today.
8. First outbound on the thread includes `Reply STOP to opt out.`
9. Signature is shop voice (“Boltz Automotive” / “we”), never a staff name.
10. `validateOutbound()` still passes (length, no discount/warranty/Sunday-hours claims).
11. `sendOutbound({ idempotencyKey: outreach:{id}:{wave} })`.

---

## Appendix D — What this pull request actually contains

| Path | Role |
| --- | --- |
| This file | The proposal you are signing off on |
| `docs/schema/proposed-customer-outreach.sql` | Draft tables. **Not** in `supabase/migrations/`. Will not apply. |
| `src/server/customer-outreach/flags.ts` | All flags **false** |
| `src/server/customer-outreach/README.md` | What flipping a flag would do (nothing until a later PR wires sends) |
| `src/lib/customer-outreach/*` | Parser + send-window sketches + tests. **Not imported** by cron, jobs, or `sendOutbound` |

There is no new cron route, no Square client, no admin page that can send, and no migration.

If someone later sets a flag to true **in this commit’s code**, the outreach module still cannot send: `assertOutreachSendAllowed()` throws, and nothing calls `sendOutbound` from this folder.
