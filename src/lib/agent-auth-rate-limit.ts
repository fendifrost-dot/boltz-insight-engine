/** Pure IP rate limiter for the stored shop-agent login: 5 failures / 15 min, then backoff. */
export const AGENT_LOGIN_MAX_FAILURES = 5;
export const AGENT_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type RateState = { failures: number; firstFailureAt: number; blockedUntil: number };

export function isBlocked(state: RateState | undefined, nowMs: number): boolean {
  return Boolean(state && state.blockedUntil > nowMs);
}

export function registerFailure(
  state: RateState | undefined,
  nowMs: number,
): RateState {
  const fresh = !state || nowMs - state.firstFailureAt > AGENT_LOGIN_WINDOW_MS;
  const failures = fresh ? 1 : state!.failures + 1;
  const firstFailureAt = fresh ? nowMs : state!.firstFailureAt;
  const over = Math.max(0, failures - AGENT_LOGIN_MAX_FAILURES);
  // Exponential backoff once the window budget is spent.
  const blockedUntil = over > 0 ? nowMs + Math.min(60, 2 ** over) * 60 * 1000 : 0;
  return { failures, firstFailureAt, blockedUntil };
}
