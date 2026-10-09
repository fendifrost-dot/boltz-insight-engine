import test from "node:test";
import assert from "node:assert/strict";
import { matchLead, nextMatch } from "./match.ts";
import { emailKey, phoneE164, phoneKey } from "./normalize.ts";
import { leadSquareRevenue, shouldMarkLeadPaid } from "./paid.ts";

const leads = [
  { id: "lead-phone", phone_e164: "+17085551212", email: "ada@example.com" },
  { id: "lead-email", phone_e164: null, email: "bea@example.com" },
  { id: "lead-other", phone_e164: "+13125550100", email: "cy@example.com" },
];

test("normalizes US phones and emails", () => {
  assert.equal(phoneKey("(708) 555-1212"), "7085551212");
  assert.equal(phoneE164("708-555-1212"), "+17085551212");
  assert.equal(phoneKey("+1 708 555 1212"), "7085551212");
  assert.equal(emailKey("  Ada@Example.com "), "ada@example.com");
  assert.equal(emailKey("not-an-email"), null);
});

test("links a unique phone, then a unique email, and refuses a conflict", () => {
  assert.deepEqual(matchLead({ phone: "7085551212", email: null, candidates: leads }), {
    leadId: "lead-phone",
    matchStatus: "exact_phone",
  });
  assert.deepEqual(matchLead({ phone: null, email: "Bea@Example.com", candidates: leads }), {
    leadId: "lead-email",
    matchStatus: "exact_email",
  });
  const conflict = matchLead({
    phone: "+17085551212",
    email: "bea@example.com",
    candidates: leads,
  });
  assert.equal(conflict.matchStatus, "ambiguous");
  assert.equal(conflict.leadId, null);
});

test("two phones or two emails stay unmatched for review", () => {
  const duplicated = [
    ...leads,
    { id: "lead-dup", phone_e164: "+17085551212", email: "ada@example.com" },
  ];
  const byPhone = matchLead({ phone: "+17085551212", email: null, candidates: duplicated });
  assert.equal(byPhone.matchStatus, "ambiguous");
  const byEmail = matchLead({ phone: null, email: "ada@example.com", candidates: duplicated });
  assert.equal(byEmail.matchStatus, "ambiguous");
  assert.deepEqual(matchLead({ phone: null, email: null, candidates: leads }), {
    leadId: null,
    matchStatus: "unmatched",
  });
});

test("a later payload without contact does not drop an exact link", () => {
  const kept = nextMatch(
    { leadId: "lead-phone", matchStatus: "exact_phone" },
    { leadId: null, matchStatus: "unmatched" },
  );
  assert.deepEqual(kept, { leadId: "lead-phone", matchStatus: "exact_phone" });
  const cleared = nextMatch(
    { leadId: "lead-phone", matchStatus: "exact_phone" },
    { leadId: null, matchStatus: "ambiguous" },
  );
  assert.equal(cleared.matchStatus, "ambiguous");
  assert.equal(cleared.leadId, null);
});

test("only a completed exact match on an open funnel lead marks Paid", () => {
  assert.equal(
    shouldMarkLeadPaid({
      paymentStatus: "COMPLETED",
      matchStatus: "exact_phone",
      lifecycle: "Estimate Sent",
    }),
    true,
  );
  assert.equal(
    shouldMarkLeadPaid({ paymentStatus: "APPROVED", matchStatus: "exact_phone", lifecycle: "New" }),
    false,
  );
  assert.equal(
    shouldMarkLeadPaid({
      paymentStatus: "COMPLETED",
      matchStatus: "ambiguous",
      lifecycle: "Completed",
    }),
    false,
  );
  assert.equal(
    shouldMarkLeadPaid({
      paymentStatus: "COMPLETED",
      matchStatus: "exact_email",
      lifecycle: "Paid",
    }),
    false,
  );
  assert.equal(
    shouldMarkLeadPaid({
      paymentStatus: "COMPLETED",
      matchStatus: "exact_phone",
      lifecycle: "Spam",
    }),
    false,
  );
});

test("summing the same Square payment twice does not double revenue", () => {
  const first = leadSquareRevenue([
    {
      status: "COMPLETED",
      amountCents: 15_000,
      refundedCents: 0,
      createdAt: "2026-03-02T15:00:00Z",
    },
  ]);
  const again = leadSquareRevenue([
    {
      status: "COMPLETED",
      amountCents: 15_000,
      refundedCents: 2_000,
      createdAt: "2026-03-02T15:00:00Z",
    },
    { status: "APPROVED", amountCents: 9_000, refundedCents: 0, createdAt: "2026-03-03T15:00:00Z" },
  ]);
  assert.equal(first.grossCents, 15_000);
  assert.equal(again.grossCents, 15_000);
  assert.equal(again.netCents, 13_000);
  assert.equal(again.paidAt, "2026-03-02T15:00:00Z");
});
