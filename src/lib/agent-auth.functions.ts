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
  return { available: storedAgentConfigured() };
});

export const storedAgentSignIn = createServerFn({ method: "POST" }).handler(async () => {
  const ip = clientIp();
  const now = Date.now();

  if (isBlocked(attempts.get(ip), now)) {
    return { ok: false as const, error: "Too many attempts. Try again later." };
  }

  const { storedAgentSignInServer } = await import("@/server/agent-auth.server");
  const result = await storedAgentSignInServer();

  if (!result.ok) {
    attempts.set(ip, registerFailure(attempts.get(ip), now));
    return { ok: false as const, error: result.error };
  }

  attempts.delete(ip);
  return {
    ok: true as const,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
  };
});
