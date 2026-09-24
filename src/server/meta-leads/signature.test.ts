import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { hmacSha256Hex, verifyHandshake, verifyMetaSignature } from "./signature.ts";

const SECRET = "app-secret-for-tests";
const BODY =
  '{"object":"page","entry":[{"id":"1","changes":[{"field":"leadgen","value":{"leadgen_id":"42"}}]}]}';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("hmacSha256Hex matches node:crypto (the algorithm Meta uses)", async () => {
  assert.equal(
    await hmacSha256Hex(SECRET, BODY),
    createHmac("sha256", SECRET).update(BODY).digest("hex"),
  );
});

test("a correctly signed body verifies", async () => {
  assert.equal(await verifyMetaSignature(BODY, sign(BODY), SECRET), true);
  assert.equal(
    await verifyMetaSignature(BODY, sign(BODY).toUpperCase().replace("SHA256=", "sha256="), SECRET),
    true,
  );
});

test("missing, malformed, wrong-secret and tampered signatures are rejected", async () => {
  assert.equal(await verifyMetaSignature(BODY, null, SECRET), false);
  assert.equal(await verifyMetaSignature(BODY, "", SECRET), false);
  assert.equal(await verifyMetaSignature(BODY, "sha1=abc", SECRET), false);
  assert.equal(await verifyMetaSignature(BODY, sign(BODY, "other-secret"), SECRET), false);
  assert.equal(await verifyMetaSignature(BODY.replace("42", "43"), sign(BODY), SECRET), false);
  assert.equal(await verifyMetaSignature(BODY, sign(BODY), ""), false);
});

test("signature is over exact bytes: re-serialized JSON does not verify", async () => {
  const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
  assert.equal(await verifyMetaSignature(reserialized, sign(BODY), SECRET), false);
});

test("handshake echoes the challenge only for subscribe + matching token", () => {
  const params = (q: string) => new URLSearchParams(q);
  assert.equal(
    verifyHandshake(params("hub.mode=subscribe&hub.verify_token=tok&hub.challenge=123"), "tok"),
    "123",
  );
  assert.equal(
    verifyHandshake(params("hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123"), "tok"),
    null,
  );
  assert.equal(
    verifyHandshake(params("hub.mode=unsubscribe&hub.verify_token=tok&hub.challenge=123"), "tok"),
    null,
  );
  assert.equal(verifyHandshake(params("hub.mode=subscribe&hub.verify_token=tok"), "tok"), null);
  assert.equal(
    verifyHandshake(params("hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), undefined),
    null,
  );
});
