/**
 * Owner-session persistence for the shop browser.
 *
 * Production never shipped the earlier stay-signed-in branch
 * (`cursor/owner-session-persist-d44d`). The published app already uses
 * Supabase `persistSession: true` with first-party localStorage — there are
 * no httpOnly auth cookies. GoTrue access tokens still expire in ~1 hour, and
 * `/_authenticated` called `getUser()` on every load, treating an expired JWT
 * (or a transient fetch after Chrome sleep/crash) as signed-out.
 *
 * Stay signed in (default) keeps the Supabase session in localStorage AND a
 * first-party 60-day refresh-token cookie. Production logs (auth.sessions)
 * show the server session stays valid (`not_after` is null) while Chrome
 * loses the localStorage copy overnight — a new session is created every
 * morning. The cookie is the same refresh token GoTrue already issued; it is
 * not an extra long-lived secret. Opting out still stores the PKCE verifier
 * in localStorage (magic link opens in another tab) but discards the session
 * on the next browser open. Sign-out clears local state and the cookie.
 */

export const OWNER_SESSION_PERSIST_KEY = "boltz-owner-session:persist";
export const OWNER_SESSION_ACTIVE_KEY = "boltz-owner-session:active";
export const OWNER_REFRESH_COOKIE = "boltz_owner_rt";
export const OWNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 60; // 60 days

export type MaybeAsyncStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export type OwnerSessionPreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function persistPreferenceEnabled(
  getItem: (key: string) => string | null | undefined,
): boolean {
  const raw = getItem(OWNER_SESSION_PERSIST_KEY);
  if (raw === "0" || raw === "false") return false;
  return true;
}

export function writePersistPreference(
  storage: OwnerSessionPreferenceStorage,
  enabled: boolean,
): void {
  storage.setItem(OWNER_SESSION_PERSIST_KEY, enabled ? "1" : "0");
}

export function extractRefreshToken(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as {
      refresh_token?: unknown;
      currentSession?: { refresh_token?: unknown };
    };
    const token = parsed.refresh_token ?? parsed.currentSession?.refresh_token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function buildRememberCookie(
  token: string,
  opts: { secure: boolean; maxAgeSeconds?: number },
): string {
  const maxAge = opts.maxAgeSeconds ?? OWNER_SESSION_MAX_AGE_SECONDS;
  const parts = [
    `${OWNER_REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearedRememberCookie(opts: { secure: boolean }): string {
  const parts = [`${OWNER_REFRESH_COOKIE}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function parseRememberCookie(cookieHeader: string): string | null {
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${OWNER_REFRESH_COOKIE}=`)) continue;
    const raw = trimmed.slice(OWNER_REFRESH_COOKIE.length + 1);
    if (!raw) return null;
    try {
      const token = decodeURIComponent(raw);
      return token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionNeedsRefresh(
  expiresAtSeconds: number | undefined,
  nowMs: number,
  skewMs = 60_000,
): boolean {
  if (!expiresAtSeconds) return true;
  return expiresAtSeconds * 1000 <= nowMs + skewMs;
}

export function isTransientAuthError(
  error: { message?: string | undefined; status?: number | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  const status = error.status;
  if (status === 0 || (typeof status === "number" && status >= 500)) return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed")
  );
}

export type AuthResolveDecision =
  | { action: "allow" }
  | { action: "refresh" }
  | { action: "restore-cookie" }
  | { action: "allow-stale" }
  | { action: "redirect-auth" };

export function nextAuthResolveStep(input: {
  hasSession: boolean;
  hasUser: boolean;
  getUserError?: { message?: string | undefined; status?: number | undefined } | null;
  hasRememberToken?: boolean;
  expiresAtSeconds?: number | undefined;
  nowMs: number;
  alreadyRefreshed?: boolean;
  alreadyRestored?: boolean;
}): AuthResolveDecision {
  if (input.hasUser) return { action: "allow" };

  if (!input.hasSession) {
    if (input.hasRememberToken && !input.alreadyRestored) return { action: "restore-cookie" };
    return { action: "redirect-auth" };
  }

  if (sessionNeedsRefresh(input.expiresAtSeconds, input.nowMs) && !input.alreadyRefreshed) {
    return { action: "refresh" };
  }

  if (isTransientAuthError(input.getUserError) && input.hasSession) {
    return { action: "allow-stale" };
  }

  if (!input.alreadyRefreshed) return { action: "refresh" };
  return { action: "redirect-auth" };
}

export function urlHasAuthCallback(search: string, hash: string): boolean {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return (
    query.has("code") ||
    query.has("token_hash") ||
    hashParams.has("access_token") ||
    hashParams.has("refresh_token")
  );
}

export function shouldDiscardEphemeralSession(input: {
  persistEnabled: boolean;
  hasActiveMarker: boolean;
  hasAuthCallback: boolean;
}): boolean {
  return !input.persistEnabled && !input.hasActiveMarker && !input.hasAuthCallback;
}

/**
 * Chrome crash / full quit clears sessionStorage (and session cookies) but
 * keeps origin localStorage. Model that here instead of assuming the session
 * was never persisted.
 */
export function simulatedBrowserRestart(input: {
  persistEnabled: boolean;
  hasPersistedSession: boolean;
  accessTokenExpired?: boolean;
  hasRememberCookie?: boolean;
}): {
  hasActiveMarker: boolean;
  hasPersistedSession: boolean;
  persistEnabled: boolean;
  accessTokenExpired: boolean;
  hasRememberCookie: boolean;
} {
  return {
    persistEnabled: input.persistEnabled,
    hasPersistedSession: input.hasPersistedSession,
    hasActiveMarker: false,
    accessTokenExpired: input.accessTokenExpired ?? false,
    hasRememberCookie: input.hasRememberCookie ?? false,
  };
}

export type OwnerAuthLaunchOutcome =
  | { outcome: "allow" }
  | { outcome: "refresh-then-allow" }
  | { outcome: "redirect-auth"; reason: "unauthenticated" | "ephemeral-expired" };

export function ownerAuthAfterLaunch(input: {
  persistEnabled: boolean;
  hasActiveMarker: boolean;
  hasAuthCallback: boolean;
  hasPersistedSession: boolean;
  accessTokenExpired: boolean;
  hasRememberCookie?: boolean;
}): OwnerAuthLaunchOutcome {
  if (
    shouldDiscardEphemeralSession({
      persistEnabled: input.persistEnabled,
      hasActiveMarker: input.hasActiveMarker,
      hasAuthCallback: input.hasAuthCallback,
    })
  ) {
    return { outcome: "redirect-auth", reason: "ephemeral-expired" };
  }

  if (!input.hasPersistedSession) {
    if (input.persistEnabled && input.hasRememberCookie) {
      return { outcome: "refresh-then-allow" };
    }
    return { outcome: "redirect-auth", reason: "unauthenticated" };
  }

  if (input.accessTokenExpired) return { outcome: "refresh-then-allow" };
  return { outcome: "allow" };
}

export function wrapOwnerSessionStorage(
  base: MaybeAsyncStorage | undefined,
  deps: {
    persistEnabled?: () => boolean;
    local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    onPersistSession?: (value: string) => void;
    onClearSession?: () => void;
  },
): MaybeAsyncStorage | undefined {
  if (!base) return undefined;

  return {
    getItem: async (key: string) => {
      const fromLocal = deps.local.getItem(key);
      if (fromLocal) return fromLocal;
      const fromBase = await base.getItem(key);
      if (fromBase) return fromBase;
      return deps.session.getItem(key);
    },
    setItem: async (key: string, value: string) => {
      // Always write localStorage so a magic-link tab can read the PKCE verifier.
      deps.local.setItem(key, value);
      await base.setItem(key, value);
      if (deps.persistEnabled?.() !== false) deps.onPersistSession?.(value);
      else deps.onClearSession?.();
    },
    removeItem: async (key: string) => {
      deps.local.removeItem(key);
      deps.session.removeItem(key);
      deps.onClearSession?.();
      await base.removeItem(key);
    },
  };
}
