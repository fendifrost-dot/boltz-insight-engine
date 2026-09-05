import {
  OWNER_SESSION_ACTIVE_KEY,
  buildClearedRememberCookie,
  buildRememberCookie,
  extractRefreshToken,
  parseRememberCookie,
  persistPreferenceEnabled,
  wrapOwnerSessionStorage,
  writePersistPreference,
  type MaybeAsyncStorage,
} from "./owner-session";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}


export function readOwnerSessionPersist(): boolean {
  if (!canUseBrowserStorage()) return true;
  try {
    return persistPreferenceEnabled((key) => window.localStorage.getItem(key));
  } catch {
    return true;
  }
}

export function setOwnerSessionPersist(enabled: boolean): void {
  if (!canUseBrowserStorage()) return;
  try {
    writePersistPreference(window.localStorage, enabled);
  } catch {
    /* storage blocked */
  }
}

export function markOwnerSessionActive(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(OWNER_SESSION_ACTIVE_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

export function clearOwnerSessionActiveMarker(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.removeItem(OWNER_SESSION_ACTIVE_KEY);
  } catch {
    /* storage blocked */
  }
}

export function hasOwnerSessionActiveMarker(): boolean {
  if (!canUseBrowserStorage()) return false;
  try {
    return window.sessionStorage.getItem(OWNER_SESSION_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

const AGENT_AUTOLOGIN_SUPPRESS_KEY = "boltz-agent-autologin-suppressed";

export function suppressAgentAutoLogin(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(AGENT_AUTOLOGIN_SUPPRESS_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

export function clearAgentAutoLoginSuppress(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.removeItem(AGENT_AUTOLOGIN_SUPPRESS_KEY);
  } catch {
    /* storage blocked */
  }
}

export function agentAutoLoginSuppressed(): boolean {
  if (!canUseBrowserStorage()) return false;
  try {
    return window.sessionStorage.getItem(AGENT_AUTOLOGIN_SUPPRESS_KEY) === "1";
  } catch {
    return false;
  }
}

function cookiesUsable(): boolean {
  return canUseBrowserStorage() && typeof document.cookie === "string";
}

function secureCookies(): boolean {
  if (typeof window === "undefined") return true;
  return window.location.protocol === "https:";
}

export function readRememberCookie(): string | null {
  if (!cookiesUsable()) return null;
  try {
    return parseRememberCookie(document.cookie);
  } catch {
    return null;
  }
}

export function writeRememberCookie(token: string | null | undefined): void {
  if (!cookiesUsable()) return;
  if (!token) return;
  if (!readOwnerSessionPersist()) {
    clearRememberCookie();
    return;
  }
  try {
    document.cookie = buildRememberCookie(token, { secure: secureCookies() });
  } catch {
    /* cookies blocked */
  }
}

export function writeRememberCookieFromSessionJson(value: string | null | undefined): void {
  writeRememberCookie(extractRefreshToken(value));
}

export function clearRememberCookie(): void {
  if (!cookiesUsable()) return;
  try {
    document.cookie = buildClearedRememberCookie({ secure: secureCookies() });
  } catch {
    /* cookies blocked */
  }
}

export function ownerAuthStorage(
  base: MaybeAsyncStorage | undefined,
): MaybeAsyncStorage | undefined {
  if (typeof window === "undefined") return base;
  return wrapOwnerSessionStorage(base, {
    local: window.localStorage,
    session: window.sessionStorage,
    persistEnabled: readOwnerSessionPersist,
    onPersistSession: writeRememberCookieFromSessionJson,
    onClearSession: clearRememberCookie,
  });
}

