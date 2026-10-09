import test from "node:test";
import assert from "node:assert/strict";
import { DROPPED_CARD_KEYS, mapPayment } from "./map.ts";
import { parseSquareNotification } from "./events.ts";
import { PUBLIC_PAYMENT_KEYS, toPublicPayment } from "./public.ts";

test("payment mapping keeps brand and last4 and drops card secrets", () => {
  const draft = mapPayment({
    id: "pay_1",
    status: "COMPLETED",
    amount_money: { amount: 2500, currency: "USD" },
    refunded_money: { amount: 0, currency: "USD" },
    source_type: "CARD",
    buyer_email_address: "Ada@Example.com",
    card_details: {
      card: {
        card_brand: "VISA",
        last_4: "4242",
        exp_month: 11,
        exp_year: 2028,
        fingerprint: "sq-fp-secret",
        cardholder_name: "Ada Lovelace",
      },
    },
    created_at: "2026-03-02T15:00:00Z",
  });
  assert.ok(draft);
  assert.equal(draft?.card_brand, "VISA");
  assert.equal(draft?.card_last4, "4242");
  assert.equal(draft?.buyer_email, "ada@example.com");
  assert.equal(draft?.amount_cents, 2500);
  const serialized = JSON.stringify(draft);
  for (const key of DROPPED_CARD_KEYS) assert.equal(serialized.includes(key), false);
  assert.equal(serialized.includes("sq-fp-secret"), false);
  assert.equal(serialized.includes("Ada Lovelace"), false);
  assert.equal(serialized.includes("2028"), false);
});

test("webhook parser reads the payment object and the event id", () => {
  const event = parseSquareNotification({
    event_id: "evt_1",
    type: "payment.updated",
    data: {
      type: "payment",
      id: "pay_1",
      object: {
        payment: {
          id: "pay_1",
          status: "COMPLETED",
          amount_money: { amount: 100, currency: "USD" },
        },
      },
    },
  });
  assert.equal(event?.eventId, "evt_1");
  assert.equal(event?.kind, "payment");
  assert.equal(event?.payment?.square_id, "pay_1");
  assert.equal(event?.payment?.amount_cents, 100);
});

test("public payment rows have no contact fields", () => {
  const row = toPublicPayment({
    square_id: "pay_1",
    status: "COMPLETED",
    amount_cents: 100,
    refunded_cents: 0,
    currency: "USD",
    created_at_square: "2026-03-02T15:00:00Z",
    lead_id: null,
    match_status: "unmatched",
    card_brand: "VISA",
    card_last4: "4242",
    order_id: null,
  });
  assert.deepEqual(Object.keys(row).sort(), [...PUBLIC_PAYMENT_KEYS].sort());
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("email"), false);
  assert.equal(serialized.includes("phone"), false);
});
