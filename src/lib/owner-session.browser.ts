import { supabase } from "@/integrations/supabase/client";
import {
  isTransientAuthError,
  nextAuthResolveStep,
  sessionNeedsRefresh,
  shouldDiscardEphemeralSession,
  urlHasAuthCallback,
} from "./owner-session";
import { shouldAutoLoginShopAgent } from "./shop-agent-auto-login";
import {
  clearManualSignOut,
  clearOwnerSessionActiveMarker,
  clearRememberCookie,
  hasManualSignOut,
  hasOwnerSessionActiveMarker,
  markManualSignOut,
  markOwnerSessionActive,
  readOwnerSessionPersist,
  readRememberCookie,
  writeRememberCookie,
} from "./owner-session.storage";

export {
  ownerAuthStorage,
  readOwnerSessionPersist,
  setOwnerSessionPersist,
} from "./owner-session.storage";
export { urlHasAuthCallback } from "./owner-session";

let restoreInflight: Promise<boolean> | null = null;

export async function restoreOwnerSessionIfNeeded(): Promise<boolean> {
  if (!restoreInflight) {
    restoreInflight = restoreOwnerSessionInner().finally(() => {
      restoreInflight = null;
    });
  }
  return restoreInflight;
}

function currentUrlHasAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  return urlHasAuthCallback(window.location.search, window.location.hash);
}

/**
 * Cookie restore: Chrome can drop localStorage between browser sessions, so
 * the refresh token GoTrue already issued is mirrored into a first-party
 * cookie. Exchange it for a fresh session and rewrite the cookie with the
 * rotated refresh token.
 */
async function tryRememberCookieRestore(): Promise<boolean> {
  if (!readOwnerSessionPersist()) return false;
  const token = readRememberCookie();
  if (!token) return false;
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });
    if (error || !data.session) {
      clearRememberCookie();
      return false;
    }
    writeRememberCookie(data.session.refresh_token);
    markOwnerSessionActive();
    return true;
  } catch {
    return false;
  }
}

async function restoreOwnerSessionInner(): Promise<boolean> {
  if (
    shouldDiscardEphemeralSession({
      persistEnabled: readOwnerSessionPersist(),
      hasActiveMarker: hasOwnerSessionActiveMarker(),
      hasAuthCallback: currentUrlHasAuthCallback(),
    })
  ) {
    clearOwnerSessionActiveMarker();
    clearRememberCookie();
    await supabase.auth.signOut({ scope: "local" });
    return tryAutoLoginShopAgent();
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    markOwnerSessionActive();
    writeRememberCookie(data.session.refresh_token);
    return true;
  }

  // No session (e.g. Chrome dropped localStorage overnight). Cookie restore
  // first; the silent stored shop-agent login stays as the fallback.
  if (await tryRememberCookieRestore()) return true;
  return tryAutoLoginShopAgent();
}

async function refreshOwnerSession(
  alreadyHasUser: { id?: string } | null | undefined,
): Promise<"retry" | "stale" | "fail"> {
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session) {
    if (isTransientAuthError(refreshError) && alreadyHasUser) return "stale";
    return "fail";
  }
  return "retry";
}

export async function resolveOwnerUser() {
  await restoreOwnerSessionIfNeeded();
  let alreadyRefreshed = false;
  let alreadyRestored = false;

  for (let i = 0; i < 4; i++) {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;

    // Refresh an expired access token before getUser() — a 401 here used to
    // look identical to a signed-out owner after Chrome crash/restart.
    if (session && sessionNeedsRefresh(session.expires_at, Date.now()) && !alreadyRefreshed) {
      alreadyRefreshed = true;
      const result = await refreshOwnerSession(session.user);
      if (result === "retry") continue;
      if (result === "stale" && session.user) return session.user;
      return null;
    }

    const { data: userData, error } = session
      ? await supabase.auth.getUser()
      : { data: { user: null }, error: null };

    const decision = nextAuthResolveStep({
      hasSession: Boolean(session),
      hasUser: Boolean(userData.user),
      getUserError: error,
      expiresAtSeconds: session?.expires_at,
      nowMs: Date.now(),
      alreadyRefreshed,
      hasRememberToken: Boolean(readRememberCookie()),
      alreadyRestored,
    });

    if (decision.action === "allow" && userData.user) return userData.user;
    if (decision.action === "allow-stale" && session?.user) return session.user;
    if (decision.action === "restore-cookie") {
      alreadyRestored = true;
      if (await tryRememberCookieRestore()) continue;
      return null;
    }
    if (decision.action === "refresh") {
      alreadyRefreshed = true;
      const result = await refreshOwnerSession(session?.user);
      if (result === "retry") continue;
      if (result === "stale" && session?.user) return session.user;
      return null;
    }
    return null;
  }
  return null;
}

/**
 * Ops routes require a staff or owner role. Explicit `false` is a denied
 * account and redirects to /auth without signing out (signing out wiped the
 * remember cookie). RPC/network errors keep the restored session.
 */
export async function resolveAuthorizedOpsUser() {
  const user = await resolveOwnerUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase.rpc("is_staff", { _user_id: user.id });
    if (error) return user;
    // A failed or false staff probe must never sign out — that wiped the
    // refresh token / remember cookie on transient RPC misses.
    if (data !== true) return null;
    return user;
  } catch {
    return user;
  }
}

export async function applyBrowserSessionTokens(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<boolean> {
  const { error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (error) return false;
  markOwnerSessionActive();
  writeRememberCookie(tokens.refresh_token);
  return true;
}

let autoLoginInflight: Promise<boolean> | null = null;
let secretsConfiguredCache: boolean | null = null;

async function storedAgentSecretsConfigured(): Promise<boolean> {
  if (secretsConfiguredCache !== null) return secretsConfiguredCache;
  try {
    const { getAgentAuthStatus } = await import("@/lib/agent-auth.functions");
    const status = await getAgentAuthStatus({});
    secretsConfiguredCache = Boolean(status?.configured);
  } catch {
    secretsConfiguredCache = false;
  }
  return secretsConfiguredCache;
}

/**
 * Silent Grok / shop-agent re-login using Lovable secrets.
 * Skips after an explicit Sign out in this tab (sessionStorage).
 * Chrome restart clears that flag so the shop computer recovers.
 */
export async function tryAutoLoginShopAgent(): Promise<boolean> {
  if (!autoLoginInflight) {
    autoLoginInflight = tryAutoLoginShopAgentInner().finally(() => {
      autoLoginInflight = null;
    });
  }
  return autoLoginInflight;
}

async function tryAutoLoginShopAgentInner(): Promise<boolean> {
  const persistEnabled = readOwnerSessionPersist();
  const { data } = await supabase.auth.getSession();
  const secretsConfigured = await storedAgentSecretsConfigured();
  if (
    !shouldAutoLoginShopAgent({
      persistEnabled,
      hasSession: Boolean(data.session),
      secretsConfigured,
      manualSignOut: hasManualSignOut(),
    })
  ) {
    return Boolean(data.session);
  }

  const { signInShopAgent } = await import("@/lib/agent-auth.functions");
  const result = await signInShopAgent({});
  if (!result.ok) return false;
  const applied = await applyBrowserSessionTokens(result.session);
  if (applied) clearManualSignOut();
  return applied;
}

export async function signOutOwnerSession(): Promise<void> {
  markManualSignOut();
  clearOwnerSessionActiveMarker();
  clearRememberCookie();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    clearOwnerSessionActiveMarker();
    clearRememberCookie();
  }
}

export function startOwnerSessionKeepalive(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
      if (session) {
        markOwnerSessionActive();
        writeRememberCookie(session.refresh_token);
      }
    }
    if (event === "SIGNED_OUT") {
      clearOwnerSessionActiveMarker();
      clearRememberCookie();
    }
  });

  const refreshIfNeeded = () => {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    void (async () => {
      const restored = await restoreOwnerSessionIfNeeded();
      if (!restored) return;
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;
      markOwnerSessionActive();
      if (sessionNeedsRefresh(sessionData.session.expires_at, Date.now())) {
        await supabase.auth.refreshSession();
      }
    })();
  };

  document.addEventListener("visibilitychange", refreshIfNeeded);
  window.addEventListener("focus", refreshIfNeeded);
  const interval = window.setInterval(refreshIfNeeded, 4 * 60_000);
  void restoreOwnerSessionIfNeeded();

  return () => {
    data.subscription.unsubscribe();
    document.removeEventListener("visibilitychange", refreshIfNeeded);
    window.removeEventListener("focus", refreshIfNeeded);
    window.clearInterval(interval);
  };
}
