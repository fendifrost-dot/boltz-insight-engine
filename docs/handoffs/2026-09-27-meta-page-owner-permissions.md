# Handoff — Page-owner permission steps for Boltz Lead Ads (Des Murray's agent)

**For:** a Claude agent with browser access, signed in to Meta as **Des
Murray**. Des admins the business portfolio **Reverse Engineers Media**
(`801445253919518`), which owns the Boltz Automotive Facebook Page.
**Why:** Boltz Automotive Inc (`8718642871495806`) runs its lead system on
this Page through a partner share. Three permission settings can only be
changed from Des's side. Everything else is already configured on Boltz's
side.

## Operating mode

- Do every step yourself, start to finish, without check-ins.
- Exhaust every option on each step before calling it blocked:
  1. Read the exact message.
  2. Try the alternate path listed for the step.
  3. Search Business settings for the named item.
  4. Retry after a reload.
- Send **one** message at the end, using the format at the bottom. Send
  nothing before that, unless you hit a stop condition.

## Hard rules

- **Do not transfer ownership** of the Page or the ad account. That is a
  separate decision for Fendi and Des.
- **Do not remove or downgrade** anyone's existing access, including Des's own.
- **Do not create, edit, pause or publish** ads, campaigns, budgets or billing,
  and do not change payment methods.
- **Do not touch** any Page, ad account or asset other than the two below.
- **Never paste** tokens, passwords or codes into chat or the final message.

## The assets

| Asset | ID | Owner |
| --- | --- | --- |
| Facebook Page **Boltz Automotive** | `433712466491882` | Reverse Engineers Media (`801445253919518`) |
| Ad account | `686411475366536` | shown as "Owned by: Individual people" |
| Partner business **Boltz Automotive Inc** | `8718642871495806` | Fendi |
| App **Boltz Insight Engine** | `2854559924918431` | Boltz Automotive Inc |

## Step 1 — Give Boltz full control of the shared Page

1. Go to **business.facebook.com → Settings**, and switch to the
   **Reverse Engineers Media** portfolio (top-left portfolio picker).
2. Open **Accounts → Pages → Boltz Automotive** → **Partners** tab.
3. Find **Boltz Automotive Inc** (`8718642871495806`) and edit its access
   to **Full control** (all tasks).
   - If Full control isn't offered, turn on every task, and at minimum these
     three:
     - Content
     - Ads (*Advertise*)
     - **Leads** (*Manage leads*)
   - If Boltz Automotive Inc isn't listed, click **Assign partner** → *Share
     using business ID* → `8718642871495806` → Full control → Assign.
4. Save. Reload, and confirm the Partners tab shows Boltz Automotive Inc with
   Full control, or with all tasks including **Leads**.

## Step 2 — Allow Boltz's CRM app to read leads (Leads Access)

This is the step Boltz can't do. Meta refuses it for Pages the business
doesn't own ("You cannot create leads access for pages that are not owned by
your business").

1. In the **Reverse Engineers Media** portfolio, open **Settings →
   Integrations → Leads Access**. Other paths to the same screen:
   - Meta Business Suite → All tools → *Instant Forms* → *CRM setup / Leads access*
   - the Page's settings → *Leads access*
2. Select the **Boltz Automotive** Page.
3. If the Page shows that leads access is **not restricted** (no Leads Access
   Manager, anyone with the Leads task can access), change nothing. Record
   "not restricted" and go to step 3.
4. If access **is** restricted:
   - **CRMs** tab → **Assign CRMs** → select **Boltz Insight Engine** (App ID
     `2854559924918431`) → Assign. If the app isn't listed, search by the App
     ID, then try adding it via *Add* / *Connect CRM*.
   - **Partners** tab, if present → assign **Boltz Automotive Inc**
     (`8718642871495806`).
   - **People** tab → make sure **Des** stays assigned. If Fendi's profile
     can be added from here, add it too.
5. Reload, and confirm **Boltz Insight Engine** is listed under CRMs, or
   that access is unrestricted.

## Step 3 — Approve Boltz's pending request on the ad account

Boltz Automotive Inc has a **pending access request** on ad account
`686411475366536`. Approving it lets Boltz's lead system attach
ad / ad set / campaign names to each lead.

1. Find the request in whichever place it shows up:
   - Des's Meta notifications / **Business Suite → Notifications → Requests**
   - Ads Manager → **Ad account settings** for `686411475366536` → *Ad account roles* / *Partners*
   - If the account sits inside a portfolio: **Business settings → Requests → Received**
2. **Approve** it, with at least **View performance** (read-only reporting).
   Grant more only if Des deliberately chooses to; read-only is enough for
   lead attribution.
3. If the request has expired or can't be found, share it directly:
   - In the ad account's settings → *Partners* / *Assign partner* → business
     ID `8718642871495806` → **View performance** → Assign.
   - Or, if only people can be added (a personal account), add **Fendi** with
     **Analyst** (view-only) access.
4. Confirm Boltz Automotive Inc (or Fendi) now shows on the ad account with
   at least view access.

## Stop conditions (report only these early)

- Meta requires a security code, 2FA or identity check that Des must enter
  personally.
- Des is not an admin of Reverse Engineers Media, or does not have access to
  the ad account.
- The only way forward is an ownership transfer (not allowed here).

In any of these cases, send the final message with `BLOCKED` in that step's
line and the exact message Meta showed.

## Final message (send once, then stop)

```
Boltz permission steps — done
1. Page partner access for Boltz Automotive Inc: <Full control | tasks: …>
2. Leads Access on Boltz Automotive Page: <CRM "Boltz Insight Engine" assigned | not restricted | BLOCKED: exact message>
3. Ad account 686411475366536: <request approved with View performance | shared directly | BLOCKED: exact message>
```

## For Fendi, after Des's agent finishes (no action needed from Des)

On Boltz's side:
- Regenerate the system-user Page token only if `/integration-health` shows a
  Graph permission failure, then re-run a Lead Ads Testing Tool lead.
- With step 3 done, new leads arrive with campaign and ad names attached, and
  **Reconcile 7 days** backfills attribution for recent leads.
