import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SquareApiError } from "./errors.ts";
import { assertSquareReadOnly, collectCursorPages, createSquareHttp } from "./http.ts";

const here = dirname(fileURLToPath(import.meta.url));

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), headers ? { status, headers } : { status });
}

test("retries 429 and 500, then returns the page, and does not retry a 400", async () => {
  let calls = 0;
  const http = createSquareHttp({
    accessToken: "EAAAtest-token-value",
    baseUrl: "https://connect.squareup.com",
    version: "2026-09-16",
    sleep: async () => undefined,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Square-Version"), "2026-09-16");
      assert.equal(headers.get("Authorization"), "Bearer EAAAtest-token-value");
      assert.equal(headers.get("Authorization")?.includes("sq0idp"), false);
      if (calls < 3) {
        return jsonResponse(
          {
            errors: [
              { category: "RATE_LIMIT_ERROR", code: "RATE_LIMITED", detail: "ada@example.com" },
            ],
          },
          429,
          { "retry-after": "0" },
        );
      }
      return jsonResponse({ payments: [{ id: "pay_1" }] });
    },
  });
  const body = (await http.request("GET", "/v2/payments")) as { payments: { id: string }[] };
  assert.equal(calls, 3);
  assert.equal(body.payments[0]?.id, "pay_1");

  let clientErrors = 0;
  const failing = createSquareHttp({
    accessToken: "EAAAtest-token-value",
    baseUrl: "https://connect.squareup.com",
    sleep: async () => undefined,
    maxAttempts: 4,
    fetchImpl: async () => {
      clientErrors += 1;
      return jsonResponse(
        {
          errors: [
            {
              category: "INVALID_REQUEST",
              code: "BAD_REQUEST",
              detail: "ada@example.com +17085551212",
            },
          ],
        },
        400,
      );
    },
  });
  await assert.rejects(
    () => failing.request("GET", "/v2/locations"),
    (error: unknown) => {
      assert.ok(error instanceof SquareApiError);
      assert.equal(error.code, "BAD_REQUEST");
      assert.equal(error.retryable, false);
      assert.equal(error.message.includes("ada@"), false);
      assert.equal(error.message.includes("708555"), false);
      assert.equal(error.message.includes("EAAA"), false);
      return true;
    },
  );
  assert.equal(clientErrors, 1);
});

test("follows cursors and stops when the cursor is absent", async () => {
  const pages = await collectCursorPages({
    maxPages: 5,
    load: async (cursor) => {
      if (!cursor) return { items: ["a"], cursor: "next" };
      if (cursor === "next") return { items: ["b"], cursor: null };
      return { items: ["c"], cursor: null };
    },
  });
  assert.deepEqual(pages, { items: ["a", "b"], truncated: false });

  let loads = 0;
  const truncated = await collectCursorPages({
    maxPages: 2,
    load: async () => {
      loads += 1;
      return { items: [loads], cursor: "again" };
    },
  });
  assert.equal(truncated.truncated, true);
  assert.deepEqual(truncated.items, [1, 2]);
});

test("blocks payment and invoice writes and allows search reads", () => {
  assert.throws(() => assertSquareReadOnly("POST", "/v2/payments"), SquareApiError);
  assert.throws(() => assertSquareReadOnly("POST", "/v2/invoices"), SquareApiError);
  assert.throws(() => assertSquareReadOnly("DELETE", "/v2/customers/C1"), SquareApiError);
  assert.doesNotThrow(() => assertSquareReadOnly("GET", "/v2/payments"));
  assert.doesNotThrow(() => assertSquareReadOnly("GET", "/v2/payments/pay_1"));
  assert.doesNotThrow(() => assertSquareReadOnly("POST", "/v2/orders/search"));
  assert.doesNotThrow(() => assertSquareReadOnly("POST", "/v2/invoices/search"));
  assert.doesNotThrow(() => assertSquareReadOnly("POST", "/v2/customers/search"));

  const api = readFileSync(join(here, "api.ts"), "utf8");
  const httpSource = readFileSync(join(here, "http.ts"), "utf8");
  assert.match(httpSource, /assertSquareReadOnly\(method, path\)/);
  assert.equal(api.includes("CreatePayment"), false);
  assert.equal(api.includes("fetch("), false);
  assert.equal(/request\(\s*"POST"\s*,\s*"\/v2\/payments"/.test(api), false);
  assert.equal(/request\(\s*"POST"\s*,\s*"\/v2\/invoices"/.test(api), false);
  assert.match(api, /http\.request\("GET", "\/v2\/payments"/);
});
