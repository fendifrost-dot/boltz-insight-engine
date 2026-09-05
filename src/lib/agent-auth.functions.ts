import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  isBlocked,
  registerFailure,
  type RateState,
} from "./agent-auth-rate-limit";

const attempts = new Map<string, RateState>();

function clientIp(): string {
  try {
    const request = getRequest();
    const headers = request?.headers;
    const forwarded = headers?.get("x-forwarded-for") ?? "";
    const first = forwarded.split(",")[0]?.trim();
    return first || headers?.get("cf-connecting-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/** Presence-only: never reveals the stored email or password. */
export const storedAgentLoginAvailable = createServerFn({ method: "GET" }).handler(async () => {
  const { storedAgentConfigured } = await import("@/server/agent-auth.server");
  return { available: await storedAgentConfigured() };
});

export const storedAgentSignIn = createServerFn({ method: "POST" }).handler(async () => {
  const ip = clientIp();
  const now = Date.now();

  if (isBlocked(attempts.get(ip), now)) {
    return { ok: false as const, error: "Too many attempts. Try again later." };
  }

  const { storedAgentSignInServer, storedAgentConfigured } = await import(
    "@/server/agent-auth.server"
  );

  // A missing configuration is not a failed attempt — don't burn rate-limiter
  // budget for callers that probe while AGENT_AUTH secrets are absent.
  if (!(await storedAgentConfigured())) {
    return { ok: false as const, error: "Stored shop-agent login is not configured." };
  }

  const result = await storedAgentSignInServer();

  if (!result.ok) {
    attempts.set(ip, registerFailure(attempts.get(ip), now));
    return { ok: false as const, error: result.error };
  }

  attempts.delete(ip);
  const { writeHttpOnlyRememberCookie } = await import("@/server/remember-cookie.server");
  writeHttpOnlyRememberCookie(result.refreshToken);
  return {
    ok: true as const,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
  };
});

/** Server-side restore: reads the HttpOnly remember cookie (invisible to JS). */
export const restorePersistentShopSession = createServerFn({ method: "GET" }).handler(async () => {
  const { restorePersistentShopSessionFromRequest } = await import(
    "@/server/remember-cookie.server"
  );
  const result = await restorePersistentShopSessionFromRequest();
  if (!result.ok) return { ok: false as const, error: result.error };
  return {
    ok: true as const,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    expiresAt: result.tokens.expiresAt,
  };
});

/** Mirrors a rotated refresh token into the HttpOnly cookie. Writes only. */
export const persistRememberToken = createServerFn({ method: "POST" })
  .inputValidator((data: { refresh_token: string }) => {
    const token = typeof data?.refresh_token === "string" ? data.refresh_token.trim() : "";
    if (!token) throw new Error("refresh_token is required");
    return { refresh_token: token };
  })
  .handler(async ({ data }) => {
    const { writeHttpOnlyRememberCookie } = await import("@/server/remember-cookie.server");
    writeHttpOnlyRememberCookie(data.refresh_token);
    return { ok: true as const };
  });

export const clearRememberToken = createServerFn({ method: "POST" }).handler(async () => {
  const { clearHttpOnlyRememberCookie } = await import("@/server/remember-cookie.server");
  clearHttpOnlyRememberCookie();
  return { ok: true as const };
});
