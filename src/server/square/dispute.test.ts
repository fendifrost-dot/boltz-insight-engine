import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapDispute } from "./map.ts";
import { parseSquareNotification } from "./events.ts";
import { assertSquareReadOnly } from "./http.ts";
import { SquareApiError } from "./errors.ts";
import { squareDisputesRequest } from "./bot-schema.ts";
import { toolDefinition } from "../mcp/protocol.ts";
import {
  PUBLIC_DISPUTE_KEYS,
  compareDisputesByDue,
  deadlineSummary,
  disputeDueSoon,
  evidenceBytesMatch,
  parseEvidenceLink,
  relatedInvoiceIds,
  sameCardPaymentIds,
  toPublicDispute,
} from "./dispute.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

const sample = {
  amount_money: { amount: 30900, currency: "USD" },
  reason: "NO_KNOWLEDGE",
  state: "EVIDENCE_REQUIRED",
  due_at: "2026-10-16T00:00:00.000Z",
  disputed_payment: { payment_id: "pay_309" },
  card_brand: "VISA",
  created_at: "2026-10-10T18:45:22.265Z",
  updated_at: "2026-10-12T19:14:42.650Z",
  brand_dispute_id: "100000809947",
  version: 2,
  location_id: "L1",
  id: "dispute_309",
  reported_at: "2026-10-10T00:00:00.000Z",
  card_details: {
    card: { last_4: "4242", fingerprint: "sq-fp-secret", exp_year: 2028 },
  },
};

test("dispute mapping stores the Square deadline and drops card secrets", () => {
  const draft = mapDispute(sample);
  assert.ok(draft);
  assert.equal(draft?.square_id, "dispute_309");
  assert.equal(draft?.payment_id, "pay_309");
  assert.equal(draft?.amount_cents, 30900);
  assert.equal(draft?.reason, "NO_KNOWLEDGE");
  assert.equal(draft?.state, "EVIDENCE_REQUIRED");
  assert.equal(draft?.card_brand, "VISA");
  assert.equal(draft?.due_by, "2026-10-16T00:00:00.000Z");
  assert.equal(draft?.square_version, 2);
  const serialized = JSON.stringify(draft);
  assert.equal(serialized.includes("4242"), false);
  assert.equal(serialized.includes("sq-fp-secret"), false);
  assert.equal(serialized.includes("2028"), false);
  assert.equal("card_last4" in (draft ?? {}), false);
});

test("dispute.created and dispute.state.updated parse as disputes", () => {
  for (const type of ["dispute.created", "dispute.state.updated"]) {
    const event = parseSquareNotification({
      event_id: "evt_dispute",
      type,
      data: {
        type: "dispute",
        id: "dispute_309",
        object: { dispute: { ...sample, state: "EVIDENCE_REQUIRED" } },
      },
    });
    assert.equal(event?.kind, "dispute");
    assert.equal(event?.objectId, "dispute_309");
    assert.equal(event?.dispute?.amount_cents, 30900);
    assert.equal(event?.dispute?.due_by, "2026-10-16T00:00:00.000Z");
  }
});

test("a response is due within 3 days, including overdue, and a later deadline waits", () => {
  const now = new Date("2026-10-12T18:00:00.000Z");
  assert.equal(
    disputeDueSoon({ state: "EVIDENCE_REQUIRED", dueBy: "2026-10-15T18:00:00.000Z" }, now),
    true,
  );
  assert.equal(
    disputeDueSoon({ state: "EVIDENCE_REQUIRED", dueBy: "2026-10-11T00:00:00.000Z" }, now),
    true,
  );
  assert.equal(
    disputeDueSoon({ state: "EVIDENCE_REQUIRED", dueBy: "2026-10-16T00:00:00.000Z" }, now),
    false,
  );
  assert.equal(disputeDueSoon({ state: "WON", dueBy: "2026-10-13T00:00:00.000Z" }, now), false);
  assert.equal(
    disputeDueSoon({ state: "INQUIRY_EVIDENCE_REQUIRED", dueBy: "2026-10-14T00:00:00.000Z" }, now),
    true,
  );
  const summary = deadlineSummary(
    [
      { disputeId: "later", state: "EVIDENCE_REQUIRED", dueBy: "2026-10-16T00:00:00.000Z" },
      { disputeId: "soon", state: "EVIDENCE_REQUIRED", dueBy: "2026-10-14T00:00:00.000Z" },
      { disputeId: "won", state: "WON", dueBy: "2026-10-13T00:00:00.000Z" },
    ],
    now,
  );
  assert.deepEqual(summary.disputeIds, ["soon"]);
  assert.equal(summary.nearestDueBy, "2026-10-14T00:00:00.000Z");
  assert.equal(summary.windowDays, 3);
});

test("disputes sort by due date with undated rows last", () => {
  const rows = [
    { disputeId: "b", dueBy: null, createdAt: "2026-10-02T00:00:00.000Z" },
    { disputeId: "a", dueBy: "2026-10-16T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" },
    { disputeId: "c", dueBy: "2026-10-14T00:00:00.000Z", createdAt: "2026-10-09T00:00:00.000Z" },
  ].sort(compareDisputesByDue);
  assert.deepEqual(
    rows.map((row) => row.disputeId),
    ["c", "a", "b"],
  );
});

test("same-card payments stay on the customer, then the lead", () => {
  const payments = [
    {
      squareId: "pay_309",
      customerId: "cust_1",
      leadId: "lead_1",
      cardBrand: "VISA",
      cardLast4: "4242",
    },
    {
      squareId: "pay_other",
      customerId: "cust_1",
      leadId: "lead_1",
      cardBrand: "visa",
      cardLast4: "4242",
    },
    {
      squareId: "pay_stranger",
      customerId: "cust_9",
      leadId: "lead_9",
      cardBrand: "VISA",
      cardLast4: "4242",
    },
    {
      squareId: "pay_other_brand",
      customerId: "cust_1",
      leadId: "lead_1",
      cardBrand: "MASTERCARD",
      cardLast4: "4242",
    },
  ];
  assert.deepEqual(
    sameCardPaymentIds({
      disputedPaymentId: "pay_309",
      cardBrand: "VISA",
      cardLast4: "4242",
      customerId: "cust_1",
      leadId: "lead_1",
      payments,
    }),
    ["pay_other"],
  );
  assert.deepEqual(
    sameCardPaymentIds({
      disputedPaymentId: "pay_309",
      cardBrand: "VISA",
      cardLast4: "4242",
      customerId: null,
      leadId: "lead_1",
      payments,
    }),
    ["pay_other"],
  );
});

test("invoices match the customer or the lead", () => {
  assert.deepEqual(
    relatedInvoiceIds({
      customerId: "cust_1",
      leadId: "lead_1",
      invoices: [
        { squareId: "inv_1", customerId: "cust_1", leadId: null },
        { squareId: "inv_2", customerId: "cust_9", leadId: "lead_1" },
        { squareId: "inv_3", customerId: "cust_9", leadId: "lead_9" },
      ],
    }),
    ["inv_1", "inv_2"],
  );
});

test("evidence links are https and files match their declared type", () => {
  assert.equal(parseEvidenceLink("https://files.example/invoice.pdf").ok, true);
  assert.equal(parseEvidenceLink("http://files.example/invoice.pdf").ok, false);
  assert.equal(parseEvidenceLink("javascript:alert(1)").ok, false);
  assert.equal(parseEvidenceLink(null).ok, true);
  assert.equal(
    evidenceBytesMatch("application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
    true,
  );
  assert.equal(evidenceBytesMatch("image/jpeg", new Uint8Array([0x25, 0x50, 0x44, 0x46])), false);
  assert.equal(
    evidenceBytesMatch("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
    true,
  );
});

test("public dispute rows have no contact fields", () => {
  const row = toPublicDispute(
    {
      square_id: "dispute_309",
      payment_id: "pay_309",
      amount_cents: 30900,
      currency: "USD",
      reason: "NO_KNOWLEDGE",
      state: "EVIDENCE_REQUIRED",
      card_brand: "VISA",
      card_last4: "4242",
      due_by: "2026-10-16T00:00:00.000Z",
      created_at_square: "2026-10-10T00:00:00.000Z",
      updated_at_square: "2026-10-12T00:00:00.000Z",
      lead_id: "00000000-0000-4000-8000-000000000001",
      customer_id: "cust_1",
      match_status: "unmatched",
    },
    new Date("2026-10-12T18:00:00.000Z"),
  );
  assert.deepEqual(Object.keys(row).sort(), [...PUBLIC_DISPUTE_KEYS].sort());
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("phone"), false);
  assert.equal(serialized.includes("email"), false);
  assert.equal(serialized.includes("body"), false);
});

test("dispute reads reject contact fields and the tool is read-only", () => {
  assert.equal(
    squareDisputesRequest.safeParse({ action: "square_disputes", dueWithinDays: 3 }).success,
    true,
  );
  assert.equal(
    squareDisputesRequest.safeParse({ action: "square_disputes", phone: "+17085550100" }).success,
    false,
  );
  const tool = toolDefinition("boltz_disputes");
  assert.equal(tool?.scope, "read");
  assert.match(tool?.description ?? "", /Does not submit evidence/);
});

test("Square writes for disputes stay blocked", () => {
  assert.throws(() => assertSquareReadOnly("POST", "/v2/disputes"), SquareApiError);
  assert.throws(
    () => assertSquareReadOnly("POST", "/v2/disputes/dispute_309/submit-evidence"),
    SquareApiError,
  );
  assert.throws(
    () => assertSquareReadOnly("POST", "/v2/disputes/dispute_309/accept"),
    SquareApiError,
  );
  assert.doesNotThrow(() => assertSquareReadOnly("GET", "/v2/disputes"));
  assert.doesNotThrow(() => assertSquareReadOnly("GET", "/v2/disputes/dispute_309"));

  const names = readdirSync(here).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
  const combined = names.map((name) => readFileSync(join(here, name), "utf8")).join("\n");
  assert.equal(/submit-evidence|submitEvidence|acceptDispute|AcceptDispute/i.test(combined), false);
  assert.match(combined, /listDisputes/);
  assert.match(readFileSync(join(here, "sync.server.ts"), "utf8"), /guard\("disputes"/);
  assert.match(readFileSync(join(here, "webhook.server.ts"), "utf8"), /event\.kind === "dispute"/);
});

test("dispute tables are forced behind RLS and the checklist is internal", () => {
  const sql = readFileSync(
    join(root, "supabase/migrations/20261012180000_square_disputes.sql"),
    "utf8",
  );
  for (const table of ["square_disputes", "square_dispute_evidence"]) {
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.%I TO service_role/);
  assert.match(sql, /due_by timestamptz/);
  assert.match(sql, /card_last4 text CHECK/);
  assert.match(sql, /estimate_repair_approval/);
  assert.match(sql, /pickup_release/);
  assert.match(sql, /customer_messages/);
  assert.match(sql, /dispute-evidence/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /fingerprint\s+text/i);
  assert.match(sql, /Never sent to Square/);
});
