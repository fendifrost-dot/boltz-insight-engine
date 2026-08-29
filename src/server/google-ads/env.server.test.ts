import test from "node:test";
import assert from "node:assert/strict";
import { classifyAdsSecretShape, normalizeCustomerId } from "./env.server.ts";

test("developer token 22-char Ads shape is ok", () => {
  const shape = classifyAdsSecretShape("GOOGLE_ADS_DEVELOPER_TOKEN", "ABcdeFGH93KL-NOPQ_STUv");
  assert.equal(shape.ok, true);
  assert.equal(shape.kind, "ads_developer_token");
});

test("Gemini AIza key in developer-token slot is flagged", () => {
  const shape = classifyAdsSecretShape(
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "AIzaSyFakeGeminiKeyForShapeTestOnly12",
  );
  assert.equal(shape.ok, false);
  assert.equal(shape.kind, "gemini_api_key");
  assert.match(shape.warning ?? "", /Gemini/);
});

test("OAuth client id and secret shapes", () => {
  const id = classifyAdsSecretShape(
    "GOOGLE_ADS_CLIENT_ID",
    "123456789012-abcdef.apps.googleusercontent.com",
  );
  assert.equal(id.ok, true);
  const secret = classifyAdsSecretShape("GOOGLE_ADS_CLIENT_SECRET", "GOCSPX-not-a-real-secret");
  assert.equal(secret.ok, true);
  const refresh = classifyAdsSecretShape("GOOGLE_ADS_REFRESH_TOKEN", "1//not-a-real-refresh");
  assert.equal(refresh.ok, true);
});

test("customer ids strip dashes to 10 digits", () => {
  assert.equal(normalizeCustomerId("166-162-6288"), "1661626288");
  const shape = classifyAdsSecretShape("GOOGLE_ADS_CUSTOMER_ID", "166-162-6288");
  assert.equal(shape.ok, true);
  assert.equal(shape.kind, "customer_id");
});
