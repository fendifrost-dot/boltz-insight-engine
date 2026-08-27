import { supabase } from "@/integrations/supabase/client";
import {
  isTransientAuthError,
  nextAuthResolveStep,
  shouldDiscardEphemeralSession,
  urlHasAuthCallback,
} from "./owner-session";
import {
  clearOwnerSessionActiveMarker,
  clearRememberCookie,
  hasOwnerSessionActiveMarker,
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

export async function resolveOwnerUser() {
  await restoreOwnerSessionIfNeeded();
  let alreadyRestored = true;
  let alreadyRefreshed = false;

  for (let i = 0; i < 4; i++) {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
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
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) {
        if (isTransientAuthError(refreshError) && session?.user) return session.user;
        return null;
      }
      continue;
    }
    return null;
  }
  return null;
}

export async function signOutOwnerSession(): Promise<void> {
  clearRememberCookie();
  clearOwnerSessionActiveMarker();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    clearRememberCookie();
    clearOwnerSessionActiveMarker();
  }
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
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        await restoreOwnerSessionIfNeeded();
        return;
      }
      markOwnerSessionActive();
      if (sessionData.session.refresh_token && readOwnerSessionPersist()) {
        writeRememberCookie(sessionData.session.refresh_token);
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
