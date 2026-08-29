import test from "node:test";
import assert from "node:assert/strict";
import { parseAdsError } from "./errors.server.ts";

test("parses USER_PERMISSION_DENIED from Ads JSON", () => {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: "The caller does not have permission",
      status: "PERMISSION_DENIED",
      details: [
        {
          errors: [
            {
              errorCode: { authorizationError: "USER_PERMISSION_DENIED" },
              message: "User doesn't have permission to access customer.",
            },
          ],
        },
      ],
    },
  });
  const parsed = parseAdsError(403, body);
  assert.equal(parsed.errorClass, "user_permission_denied");
  assert.equal(parsed.googleCode, "USER_PERMISSION_DENIED");
  assert.doesNotMatch(parsed.message, /ya29|1\/\//);
});

test("parses SERVICE_DISABLED", () => {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: "Google Ads API has not been used in project 123456789012 before or it is disabled.",
      status: "PERMISSION_DENIED",
      details: [{ reason: "SERVICE_DISABLED" }],
    },
  });
  const parsed = parseAdsError(403, body);
  assert.equal(parsed.errorClass, "service_disabled");
});

test("sunset versions are HTML 404 not 403", () => {
  const parsed = parseAdsError(404, "<!DOCTYPE html><title>Error 404 (Not Found)!!1</title>");
  assert.equal(parsed.errorClass, "sunset_404");
});

test("redacts access tokens from error text", () => {
  const parsed = parseAdsError(401, "token ya29.a0AfH6SMA-not-real leaked");
  assert.doesNotMatch(parsed.message, /ya29\.a0/);
  assert.match(parsed.message, /\[redacted-token\]/);
});
