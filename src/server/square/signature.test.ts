import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { squareSignature, verifySquareSignature } from "./signature.ts";

const KEY = "asdf1234";
const URL = "https://example.com/webhook";
const BODY = '{"hello":"world"}';
const SAMPLE = "2kRE5qRU2tR+tBGlDwMEw2avJ7QM4ikPYD/PJ3bd9Og=";

test("matches Square's published HMAC-SHA256 sample", () => {
  assert.equal(squareSignature(KEY, URL, BODY), SAMPLE);
  assert.equal(
    createHmac("sha256", KEY)
      .update(URL + BODY, "utf8")
      .digest("base64"),
    SAMPLE,
  );
  assert.equal(
    verifySquareSignature({
      rawBody: BODY,
      signatureHeader: SAMPLE,
      signatureKey: KEY,
      notificationUrl: URL,
    }),
    true,
  );
});

test("rejects a missing key, a bad signature, a different url, and a re-serialized body", () => {
  assert.equal(
    verifySquareSignature({
      rawBody: BODY,
      signatureHeader: SAMPLE,
      signatureKey: null,
      notificationUrl: URL,
    }),
    false,
  );
  assert.equal(
    verifySquareSignature({
      rawBody: BODY,
      signatureHeader: null,
      signatureKey: KEY,
      notificationUrl: URL,
    }),
    false,
  );
  assert.equal(
    verifySquareSignature({
      rawBody: BODY,
      signatureHeader: SAMPLE,
      signatureKey: KEY,
      notificationUrl: null,
    }),
    false,
  );
  assert.equal(
    verifySquareSignature({
      rawBody: BODY,
      signatureHeader: squareSignature("other", URL, BODY),
      signatureKey: KEY,
      notificationUrl: URL,
    }),
    false,
  );
  assert.equal(
    verifySquareSignature({
      rawBody: BODY,
      signatureHeader: SAMPLE,
      signatureKey: KEY,
      notificationUrl: "https://example.com/webhook/",
    }),
    false,
  );
  const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
  assert.equal(
    verifySquareSignature({
      rawBody: reserialized,
      signatureHeader: SAMPLE,
      signatureKey: KEY,
      notificationUrl: URL,
    }),
    false,
  );
});
