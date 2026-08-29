import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseNextStep } from "./google-ads-diagnose.ts";

test("Gemini key warning wins over error class", () => {
  const step = diagnoseNextStep({
    errorClass: "user_permission_denied",
    shapeWarnings: ["GOOGLE_ADS_DEVELOPER_TOKEN: Gemini / AI Studio API key"],
    configuredCustomerInAccessible: null,
    configuredLoginInAccessible: null,
    directAccessOk: null,
    hasLoginCustomerId: true,
  });
  assert.match(step, /Gemini/);
  assert.match(step, /API Center/);
});

test("direct access success tells Fendi to clear login-customer-id", () => {
  const step = diagnoseNextStep({
    errorClass: "user_permission_denied",
    shapeWarnings: [],
    configuredCustomerInAccessible: true,
    configuredLoginInAccessible: false,
    directAccessOk: true,
    hasLoginCustomerId: true,
  });
  assert.match(step, /Clear GOOGLE_ADS_LOGIN_CUSTOMER_ID/);
});

test("MCC visible but client missing points at Accounts linkage", () => {
  const step = diagnoseNextStep({
    errorClass: "user_permission_denied",
    shapeWarnings: [],
    configuredCustomerInAccessible: false,
    configuredLoginInAccessible: true,
    directAccessOk: false,
    hasLoginCustomerId: true,
  });
  assert.match(step, /509-490-7041/);
  assert.match(step, /166-162-6288/);
  assert.match(step, /Accounts/);
});

test("neither account visible means remint refresh token", () => {
  const step = diagnoseNextStep({
    errorClass: "user_permission_denied",
    shapeWarnings: [],
    configuredCustomerInAccessible: false,
    configuredLoginInAccessible: false,
    directAccessOk: false,
    hasLoginCustomerId: true,
  });
  assert.match(step, /GOOGLE_ADS_REFRESH_TOKEN/);
  assert.match(step, /adwords/);
});

test("service_disabled points at Cloud Library Enable", () => {
  const step = diagnoseNextStep({
    errorClass: "service_disabled",
    shapeWarnings: [],
    configuredCustomerInAccessible: null,
    configuredLoginInAccessible: null,
    directAccessOk: null,
    hasLoginCustomerId: true,
  });
  assert.match(step, /Google Ads API/);
  assert.match(step, /Enable/);
});
