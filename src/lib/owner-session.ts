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
 * Stay signed in (default) keeps the existing localStorage session and
 * refreshes the access token after process death. Opting out still stores the
 * PKCE verifier in localStorage (magic link opens in another tab) but discards
 * the session on the next browser open. Sign-out always clears local state.
 * This does not open public signup and does not copy refresh tokens into
 * document.cookie.
 */

export const OWNER_SESSION_PERSIST_KEY = "boltz-owner-session:persist";
export const OWNER_SESSION_ACTIVE_KEY = "boltz-owner-session:active";
export const OWNER_SESSION_MANUAL_SIGNOUT_KEY = "boltz-owner-session:manual-signout";

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
  | { action: "allow-stale" }
  | { action: "redirect-auth" };

export function nextAuthResolveStep(input: {
  hasSession: boolean;
  hasUser: boolean;
  getUserError?: { message?: string | undefined; status?: number | undefined } | null;
  expiresAtSeconds?: number | undefined;
  nowMs: number;
  alreadyRefreshed?: boolean;
}): AuthResolveDecision {
  if (input.hasUser) return { action: "allow" };

  if (!input.hasSession) return { action: "redirect-auth" };

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
}): {
  hasActiveMarker: boolean;
  hasPersistedSession: boolean;
  persistEnabled: boolean;
  accessTokenExpired: boolean;
} {
  return {
    persistEnabled: input.persistEnabled,
    hasPersistedSession: input.hasPersistedSession,
    hasActiveMarker: false,
    accessTokenExpired: input.accessTokenExpired ?? false,
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
    return { outcome: "redirect-auth", reason: "unauthenticated" };
  }

  if (input.accessTokenExpired) return { outcome: "refresh-then-allow" };
  return { outcome: "allow" };
}

export function wrapOwnerSessionStorage(
  base: MaybeAsyncStorage | undefined,
  deps: {
    local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
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
    },
    removeItem: async (key: string) => {
      deps.local.removeItem(key);
      deps.session.removeItem(key);
      await base.removeItem(key);
    },
  };
}
