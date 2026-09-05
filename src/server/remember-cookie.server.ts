// Server-only persistence of the GoTrue refresh token in an HttpOnly cookie.
// document.cookie cannot read HttpOnly cookies, so restore must happen here.
// Tokens are never logged.
import { createClient } from "@supabase/supabase-js";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";

export const REMEMBER_COOKIE_NAME = "boltz_owner_rt";
export const REMEMBER_COOKIE_MAX_AGE = 5_184_000; // 60 days

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: REMEMBER_COOKIE_MAX_AGE,
  path: "/",
};

export type RestoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseCookieHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key?.trim() === name) {
      const value = rest.join("=").trim();
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export function readRememberTokenFromRequest(): string | null {
  try {
    const direct = getCookie(REMEMBER_COOKIE_NAME);
    if (direct) return direct;
  } catch {
    /* outside a request context */
  }
  try {
    const request = getRequest();
    return parseCookieHeader(request?.headers?.get("cookie"), REMEMBER_COOKIE_NAME);
  } catch {
    return null;
  }
}

export function writeHttpOnlyRememberCookie(token: string): void {
  if (!token) return;
  try {
    setCookie(REMEMBER_COOKIE_NAME, token, COOKIE_OPTIONS);
  } catch {
    /* outside a request context */
  }
}

export function clearHttpOnlyRememberCookie(): void {
  try {
    deleteCookie(REMEMBER_COOKIE_NAME, { path: "/", secure: true, sameSite: "lax" });
  } catch {
    /* outside a request context */
  }
}

function anonClient() {
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export async function refreshSessionFromRememberToken(
  token: string,
): Promise<RestoredTokens | null> {
  if (!token) return null;
  const client = anonClient();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.refreshSession({ refresh_token: token });
    if (error || !data.session) return null;
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Restore the shop session for the current request: refresh the HttpOnly
 * cookie's token when possible, otherwise fall back to the vault/env stored
 * shop-agent login. Always rewrites the cookie with the newest refresh token.
 */
export async function restorePersistentShopSessionFromRequest(): Promise<
  { ok: true; tokens: RestoredTokens } | { ok: false; error: string }
> {
  const cookieToken = readRememberTokenFromRequest();
  if (cookieToken) {
    const refreshed = await refreshSessionFromRememberToken(cookieToken);
    if (refreshed) {
      writeHttpOnlyRememberCookie(refreshed.refreshToken);
      return { ok: true, tokens: refreshed };
    }
  }

  const { storedAgentSignInServer, storedAgentConfigured } = await import(
    "@/server/agent-auth.server"
  );
  if (!storedAgentConfigured()) {
    clearHttpOnlyRememberCookie();
    return { ok: false, error: "No persisted session available." };
  }

  const result = await storedAgentSignInServer();
  if (!result.ok) {
    clearHttpOnlyRememberCookie();
    return { ok: false, error: result.error };
  }

  writeHttpOnlyRememberCookie(result.refreshToken);
  return {
    ok: true,
    tokens: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    },
  };
}
