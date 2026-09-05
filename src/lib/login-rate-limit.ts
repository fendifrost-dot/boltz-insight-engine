/** In-memory / storage-backed login throttle. Never stores passwords. */

export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60_000,
  maxFailures: 5,
  baseLockMs: 60_000,
  maxLockMs: 15 * 60_000,
} as const;

export type LoginAttemptRecord = {
  failures: number;
  windowStartMs: number;
  lockedUntilMs: number;
};

export type LoginRateDecision = {
  allowed: boolean;
  retryAfterMs: number;
  record: LoginAttemptRecord;
};

function emptyRecord(nowMs: number): LoginAttemptRecord {
  return { failures: 0, windowStartMs: nowMs, lockedUntilMs: 0 };
}

export function evaluateLoginRateLimit(
  record: LoginAttemptRecord | undefined,
  nowMs: number,
): LoginRateDecision {
  if (!record) {
    return { allowed: true, retryAfterMs: 0, record: emptyRecord(nowMs) };
  }

  if (record.lockedUntilMs > nowMs) {
    return { allowed: false, retryAfterMs: record.lockedUntilMs - nowMs, record };
  }

  if (nowMs - record.windowStartMs > LOGIN_RATE_LIMIT.windowMs) {
    return { allowed: true, retryAfterMs: 0, record: emptyRecord(nowMs) };
  }

  return { allowed: true, retryAfterMs: 0, record };
}

export function recordLoginFailure(record: LoginAttemptRecord, nowMs: number): LoginAttemptRecord {
  const inWindow = nowMs - record.windowStartMs <= LOGIN_RATE_LIMIT.windowMs;
  const failures = inWindow ? record.failures + 1 : 1;
  const windowStartMs = inWindow ? record.windowStartMs : nowMs;
  const over = Math.max(0, failures - LOGIN_RATE_LIMIT.maxFailures);
  const lockMs =
    over > 0
      ? Math.min(LOGIN_RATE_LIMIT.maxLockMs, LOGIN_RATE_LIMIT.baseLockMs * 2 ** (over - 1))
      : 0;
  return {
    failures,
    windowStartMs,
    lockedUntilMs: lockMs > 0 ? nowMs + lockMs : 0,
  };
}

export function recordLoginSuccess(): LoginAttemptRecord {
  return emptyRecord(0);
}

export function formatRetryAfter(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}
