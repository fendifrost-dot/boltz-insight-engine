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
  clearAgentAutoLoginSuppress,
  clearOwnerSessionActiveMarker,
  hasOwnerSessionActiveMarker,
  markOwnerSessionActive,
  readOwnerSessionPersist,
  suppressAgentAutoLogin,
} from "./owner-session.storage";
import { storedAgentSignIn } from "./agent-auth.functions";

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
    const res = await storedAgentSignIn();
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
    clearOwnerSessionActiveMarker();
    await supabase.auth.signOut({ scope: "local" });
    return false;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    markOwnerSessionActive();
    return true;
  }
  return false;
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
    });

    if (decision.action === "allow" && userData.user) return userData.user;
    if (decision.action === "allow-stale" && session?.user) return session.user;
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
  clearOwnerSessionActiveMarker();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    clearOwnerSessionActiveMarker();
  }
}

export function startOwnerSessionKeepalive(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
      if (session) markOwnerSessionActive();
    }
    if (event === "SIGNED_OUT") {
      clearOwnerSessionActiveMarker();
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
  void restoreOwnerSessionIfNeeded();

  return () => {
    data.subscription.unsubscribe();
    document.removeEventListener("visibilitychange", refreshIfNeeded);
    window.removeEventListener("focus", refreshIfNeeded);
  };
}
