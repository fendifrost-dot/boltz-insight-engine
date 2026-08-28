# Shop Manager — next architecture steps

This note records what is still required after the appointments vertical slice (PR #15). It does not invent product policy, tax rules, provider behavior, or shop capacity.

## Estimates and revisions

- A durable `estimates` model with immutable revision history, line items, labor/parts separation, and linkage to inspection/appointment records.
- Server-side revision workflow (draft → sent → superseded) with audit events and staff capability gates beyond `cases.transition`.
- UI for staff to compose, revise, and compare estimate versions tied to a lead and vehicle context.

## Invoice numbering and immutability

- Owner decision on invoice numbering policy (sequential vs. gap-tolerant vs. fiscal-year scoped).
- Immutable posted invoices with adjustment/credit-note pattern instead of silent row edits.
- Cross-links from estimate approval → invoice creation with evidence preserved in `lead_events`.

## Tax handling

- Owner decision on taxable labor/parts rules, exempt customers, and jurisdiction (Illinois/Cook County/Chicago specifics require verified configuration).
- Tax calculation service that runs at estimate and invoice time with stored rate snapshots for auditability.
- No tax logic should be inferred by the agent until policy is explicitly configured.

## Payment recording

- Payment capture model separate from lifecycle `Paid` (method, amount, reference, processor metadata).
- Owner-only `financial_status.confirm` already gates `Paid`; payment recording must feed that evidence path.
- Reconciliation for partial payments, refunds, and chargebacks without rewriting invoice immutability.

## AllData estimate ingestion

- Confirm AllData API/export availability, authentication, and field mapping with the shop.
- Ingestion jobs with idempotency, correlation, and human review for unmatched VIN/vehicle records.
- Do not auto-apply imported totals without staff confirmation.

## Email and SMS document delivery

- Outbound document send path should reuse PR #14 reservation/idempotency patterns.
- Template + consent checks before estimate/invoice links or attachments.
- Delivery audit separate from conversational SMS agent runs.

## Lead-source conversion reporting

- Attribution dimensions on leads/appointments/estimates/invoices (source, campaign, first-touch vs. assisted).
- Reporting views that do not mutate lifecycle history retroactively.
- Owner workflow for `attribution.correct` with audit events.

## Dependencies on current foundation

PRs #12–#14 provide job lease recovery, prompt deduplication, correlation identity, and outbound idempotency required before scaling operational workflows. Appointments (PR #15) use the existing capability layer and lifecycle transition service but do not yet connect Grok autonomous booking, invoicing, or AllData.
