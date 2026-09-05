import { supabase } from "@/integrations/supabase/client";
import {
  isTransientAuthError,
  nextAuthResolveStep,
  sessionNeedsRefresh,
  shouldDiscardEphemeralSession,
  urlHasAuthCallback,
} from "./owner-session";
import {
  agentAutoLoginSuppressed,
  clearOwnerSessionActiveMarker,
  clearRememberCookie,
  hasOwnerSessionActiveMarker,
  markOwnerSessionActive,
  readOwnerSessionPersist,
  readRememberCookie,
  suppressAgentAutoLogin,
  writeRememberCookie,
} from "./owner-session.storage";
import { storedAgentLoginAvailable, storedAgentSignIn } from "./agent-auth.functions";

export {
  ownerAuthStorage,
  readOwnerSessionPersist,
  setOwnerSessionPersist,
} from "./owner-session.storage";
export { urlHasAuthCallback } from "./owner-session";

let restoreInflight: Promise<boolean> | null = null;
let agentRestoreInflight: Promise<boolean> | null = null;

/**
 * Silent shop-agent recovery: when the browser session is gone but the stored
 * shop-agent secrets are configured, re-sign in server-side (password never
 * leaves the server) and apply the returned tokens. Skipped when Stay signed
 * in is off or when this tab's human clicked Sign out (sessionStorage flag —
 * cleared by a Chrome restart, so the shop computer recovers after a crash).
 */
export async function trySilentAgentRestore(): Promise<boolean> {
  if (!agentRestoreInflight) {
    agentRestoreInflight = trySilentAgentRestoreInner().finally(() => {
      agentRestoreInflight = null;
    });
  }
  return agentRestoreInflight;
}

async function trySilentAgentRestoreInner(): Promise<boolean> {
  if (!readOwnerSessionPersist()) return false;
  if (agentAutoLoginSuppressed()) return false;

  const { data } = await supabase.auth.getSession();
  if (data.session) return true;

  try {
    // Skip the sign-in call entirely when the AGENT_AUTH secrets are missing —
    // otherwise every /auth visit and keepalive tick burns a rate-limiter hit.
    const availability = await storedAgentLoginAvailable();
    if (!availability?.available) return false;

    const res = await storedAgentSignIn({});
    if (!res?.ok) return false;
    const { error } = await supabase.auth.setSession({
      access_token: res.accessToken,
      refresh_token: res.refreshToken,
    });
    if (error) return false;
    markOwnerSessionActive();
    return true;
  } catch {
    return false;
  }
}

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

async function restoreOwnerSessionInner(): Promise<boolean> {
  if (
    shouldDiscardEphemeralSession({
      persistEnabled: readOwnerSessionPersist(),
      hasActiveMarker: hasOwnerSessionActiveMarker(),
      hasAuthCallback: currentUrlHasAuthCallback(),
    })
  ) {
    clearRememberCookie();
    clearOwnerSessionActiveMarker();
    await supabase.auth.signOut({ scope: "local" });
    return false;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    markOwnerSessionActive();
    if (data.session.refresh_token && readOwnerSessionPersist()) {
      writeRememberCookie(data.session.refresh_token);
    }
    return true;
  }

  if (!readOwnerSessionPersist()) return false;
  const token = readRememberCookie();
  if (!token) return false;

  const { data: restored, error } = await supabase.auth.refreshSession({ refresh_token: token });
  if (error || !restored.session) {
    clearRememberCookie();
    return false;
  }
  markOwnerSessionActive();
  if (restored.session.refresh_token) writeRememberCookie(restored.session.refresh_token);
  return true;
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
  let alreadyRestored = true;

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
      hasRememberToken: Boolean(readOwnerSessionPersist() && readRememberCookie()),
      expiresAtSeconds: session?.expires_at,
      nowMs: Date.now(),
      alreadyRefreshed,
      alreadyRestored,
    });

    if (decision.action === "allow" && userData.user) return userData.user;
    if (decision.action === "allow-stale" && session?.user) return session.user;
    if (decision.action === "restore-cookie") {
      alreadyRestored = true;
      const ok = await restoreOwnerSessionIfNeeded();
      if (!ok) return null;
      continue;
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

export async function signOutOwnerSession(): Promise<void> {
  // A human click on Sign out suppresses silent agent auto-login for this tab
  // only (sessionStorage), so the shop computer still recovers after a Chrome
  // restart clears it.
  suppressAgentAutoLogin();
  clearRememberCookie();
  clearOwnerSessionActiveMarker();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    clearRememberCookie();
    clearOwnerSessionActiveMarker();
  }
}

export async function resolveOwnerUserWithAgentRestore() {
  const user = await resolveOwnerUser();
  if (user) return user;
  const restored = await trySilentAgentRestore();
  return restored ? resolveOwnerUser() : null;
}

export function startOwnerSessionKeepalive(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
      if (session) markOwnerSessionActive();
      if (session?.refresh_token && readOwnerSessionPersist()) {
        writeRememberCookie(session.refresh_token);
      }
    }
    if (event === "SIGNED_OUT") {
      clearRememberCookie();
      clearOwnerSessionActiveMarker();
    }
  });

  const refreshIfNeeded = () => {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    void (async () => {
      const restored = await restoreOwnerSessionIfNeeded();
      if (!restored) {
        // Session is gone — try the silent stored shop-agent restore.
        await trySilentAgentRestore();
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;
      markOwnerSessionActive();
      if (sessionData.session.refresh_token && readOwnerSessionPersist()) {
        writeRememberCookie(sessionData.session.refresh_token);
      }
      if (sessionNeedsRefresh(sessionData.session.expires_at, Date.now())) {
        await supabase.auth.refreshSession();
      }
    })();
  };

  const interval = window.setInterval(refreshIfNeeded, 4 * 60 * 1000);
  document.addEventListener("visibilitychange", refreshIfNeeded);
  window.addEventListener("focus", refreshIfNeeded);
  void restoreOwnerSessionIfNeeded();

  return () => {
    data.subscription.unsubscribe();
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", refreshIfNeeded);
    window.removeEventListener("focus", refreshIfNeeded);
  };
}
