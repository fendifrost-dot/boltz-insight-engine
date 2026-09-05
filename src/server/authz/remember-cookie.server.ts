/**
 * HttpOnly remember-cookie helpers. Import only from createServerFn handlers.
 * The shop Chrome cookie is HttpOnly, so document.cookie cannot restore it
 * after a quit — the server must read the Cookie header instead.
 */
import { createClient } from "@supabase/supabase-js";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { pickSessionTokens, type BrowserSessionTokens } from "@/lib/agent-auth";
import {
  OWNER_REFRESH_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  parseRememberCookie,
} from "@/lib/owner-session";

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  path: "/",
};

export function readRememberTokenFromRequest(): string | undefined {
  try {
    const direct = getCookie(OWNER_REFRESH_COOKIE);
    if (direct && direct.trim()) return direct.trim();
  } catch {
    /* not in a request */
  }
  try {
    const header = getRequest().headers.get("cookie");
    return parseRememberCookie(header) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeHttpOnlyRememberCookie(token: string | null | undefined): void {
  if (!token) return;
  try {
    setCookie(OWNER_REFRESH_COOKIE, token, cookieOptions);
  } catch {
    /* not in a request */
  }
}

export function clearHttpOnlyRememberCookie(): void {
  try {
    deleteCookie(OWNER_REFRESH_COOKIE, { path: "/", secure: true });
  } catch {
    /* not in a request */
  }
}

function createAnonAuthClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Supabase is not configured");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function refreshSessionFromRememberToken(
  token: string,
): Promise<BrowserSessionTokens | null> {
  try {
    const client = createAnonAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: token });
    const tokens = pickSessionTokens(data.session);
    if (error || !tokens) return null;
    return tokens;
  } catch {
    return null;
  }
}

export async function restorePersistentShopSessionFromRequest(): Promise<
  { ok: true; session: BrowserSessionTokens } | { ok: false; reason: string }
> {
  const existing = readRememberTokenFromRequest();
  if (existing) {
    const refreshed = await refreshSessionFromRememberToken(existing);
    if (refreshed) {
      writeHttpOnlyRememberCookie(refreshed.refresh_token);
      return { ok: true, session: refreshed };
    }
  }

  const { signInWithStoredAgentCredentials } = await import("./agent-login.server");
  const stored = await signInWithStoredAgentCredentials();
  if (stored.ok) {
    writeHttpOnlyRememberCookie(stored.session.refresh_token);
  }
  return stored;
}
