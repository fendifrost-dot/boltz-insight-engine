import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { squarePaymentsRequest, squareRevenueRequest } from "./bot-schema.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("square bot reads accept the action and reject contact fields", () => {
  assert.equal(squareRevenueRequest.safeParse({ action: "square_revenue" }).success, true);
  assert.equal(
    squareRevenueRequest.safeParse({
      action: "square_revenue",
      since: "2026-01-05",
      until: "2026-03-02",
    }).success,
    true,
  );
  assert.equal(
    squareRevenueRequest.safeParse({ action: "square_revenue", email: "ada@example.com" }).success,
    false,
  );
  assert.equal(
    squarePaymentsRequest.safeParse({ action: "square_payments", limit: 20 }).success,
    true,
  );
  assert.equal(
    squarePaymentsRequest.safeParse({
      action: "square_payments",
      leadId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    squarePaymentsRequest.safeParse({ action: "square_payments", phone: "+17085550100" }).success,
    false,
  );
});

test("SMS handling does not import the Square client until a Square action is asked for", () => {
  const source = readFileSync(join(here, "../lead-inbox/bot-api.server.ts"), "utf8");
  assert.match(source, /action === "square_revenue" \|\| action === "square_payments"/);
  assert.match(source, /import\("@\/server\/square\/read\.server"\)/);
  assert.equal(source.includes('from "@/server/square/'), false);
});
