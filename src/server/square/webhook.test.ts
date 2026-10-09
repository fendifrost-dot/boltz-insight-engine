import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { squareSignature } from "./signature.ts";
import { processSquareWebhook } from "./webhook.ts";
import { leadSquareRevenue } from "./paid.ts";

const here = dirname(fileURLToPath(import.meta.url));
const KEY = "signature-key";
const URL = "https://boltz-insight-engine.lovable.app/api/public/square/webhook";

function bodyFor(eventId: string): string {
  return JSON.stringify({
    event_id: eventId,
    type: "payment.updated",
    data: {
      type: "payment",
      id: "pay_1",
      object: {
        payment: {
          id: "pay_1",
          status: "COMPLETED",
          amount_money: { amount: 4200, currency: "USD" },
        },
      },
    },
  });
}

test("rejects events until the signature key and notification url are set", async () => {
  let claims = 0;
  const missing = await processSquareWebhook({
    rawBody: bodyFor("evt_1"),
    signatureHeader: "anything",
    signatureKey: null,
    notificationUrl: URL,
    claim: async () => {
      claims += 1;
      return "new";
    },
    apply: async () => undefined,
    finish: async () => undefined,
  });
  assert.equal(missing.status, 503);
  assert.equal(claims, 0);

  const noUrl = await processSquareWebhook({
    rawBody: bodyFor("evt_1"),
    signatureHeader: "anything",
    signatureKey: KEY,
    notificationUrl: null,
    claim: async () => {
      claims += 1;
      return "new";
    },
    apply: async () => undefined,
    finish: async () => undefined,
  });
  assert.equal(noUrl.status, 503);
  assert.equal(claims, 0);
});

test("rejects a bad signature and dedupes a processed event id", async () => {
  const raw = bodyFor("evt_1");
  let applies = 0;
  const bad = await processSquareWebhook({
    rawBody: raw,
    signatureHeader: "not-the-signature",
    signatureKey: KEY,
    notificationUrl: URL,
    claim: async () => "new",
    apply: async () => {
      applies += 1;
    },
    finish: async () => undefined,
  });
  assert.equal(bad.status, 403);
  assert.equal(applies, 0);

  const seen = new Set<string>();
  const amounts = new Map<string, number>();
  const run = (claim: "new" | "duplicate") =>
    processSquareWebhook({
      rawBody: raw,
      signatureHeader: squareSignature(KEY, URL, raw),
      signatureKey: KEY,
      notificationUrl: URL,
      claim: async (event) => {
        if (seen.has(event.eventId) && claim === "duplicate") return "duplicate";
        seen.add(event.eventId);
        return "new";
      },
      apply: async (event) => {
        applies += 1;
        const cents = event.payment?.amount_cents ?? 0;
        amounts.set(event.payment?.square_id ?? event.eventId, cents);
      },
      finish: async () => undefined,
    });

  const first = await run("new");
  assert.equal(first.status, 200);
  assert.equal(first.body["duplicate"], false);
  const second = await processSquareWebhook({
    rawBody: raw,
    signatureHeader: squareSignature(KEY, URL, raw),
    signatureKey: KEY,
    notificationUrl: URL,
    claim: async () => "duplicate",
    apply: async () => {
      applies += 1;
    },
    finish: async () => undefined,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body["duplicate"], true);
  assert.equal(applies, 1);
  const revenue = leadSquareRevenue(
    [...amounts.entries()].map(([id, amountCents]) => ({
      status: "COMPLETED",
      amountCents,
      refundedCents: 0,
      createdAt: "2026-03-02T15:00:00Z",
      id,
    })),
  );
  assert.equal(revenue.grossCents, 4200);
});

test("the webhook route does not log the request body", () => {
  const route = readFileSync(join(here, "../../routes/api/public/square/webhook.ts"), "utf8");
  assert.match(route, /receiveSquareWebhook/);
  assert.equal(route.includes("console.log"), false);
  assert.equal(route.includes("SQUARE_ACCESS_TOKEN"), false);
});
