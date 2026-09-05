import test from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_RATE_LIMIT,
  evaluateLoginRateLimit,
  formatRetryAfter,
  recordLoginFailure,
  recordLoginSuccess,
} from "./login-rate-limit.ts";

test("login rate limit allows the first attempts in a window", () => {
  const first = evaluateLoginRateLimit(undefined, 1_000);
  assert.equal(first.allowed, true);
  assert.equal(first.retryAfterMs, 0);
});

test("login rate limit locks after max failures and backs off", () => {
  let record = evaluateLoginRateLimit(undefined, 0).record;
  for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailures; i++) {
    record = recordLoginFailure(record, 1_000 + i);
    assert.equal(record.lockedUntilMs, 0);
  }
  record = recordLoginFailure(record, 2_000);
  assert.ok(record.lockedUntilMs >= 2_000 + LOGIN_RATE_LIMIT.baseLockMs);

  const blocked = evaluateLoginRateLimit(record, 2_500);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test("login rate limit resets after the window", () => {
  let record = evaluateLoginRateLimit(undefined, 0).record;
  record = recordLoginFailure(record, 0);
  const later = evaluateLoginRateLimit(record, LOGIN_RATE_LIMIT.windowMs + 10);
  assert.equal(later.allowed, true);
  assert.equal(later.record.failures, 0);
});

test("successful login clears the failure window", () => {
  const cleared = recordLoginSuccess();
  assert.equal(cleared.failures, 0);
  assert.equal(cleared.lockedUntilMs, 0);
});

test("formatRetryAfter uses seconds then minutes", () => {
  assert.equal(formatRetryAfter(1_500), "2s");
  assert.equal(formatRetryAfter(90_000), "2m");
});
