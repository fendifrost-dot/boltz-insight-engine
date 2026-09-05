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

function browserSecure(): boolean {
  return typeof location !== "undefined" && location.protocol === "https:";
}

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
    if (!enabled) clearRememberCookie();
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

export function readRememberCookie(): string | null {
  if (!canUseBrowserStorage()) return null;
  return parseRememberCookie(document.cookie);
}

export function writeRememberCookieFromSessionJson(value: string): void {
  const token = extractRefreshToken(value);
  if (token) writeRememberCookie(token);
}

export function writeRememberCookie(token: string): void {
  if (!canUseBrowserStorage() || !readOwnerSessionPersist()) return;
  document.cookie = buildRememberCookie(token, { secure: browserSecure() });
}

export function clearRememberCookie(): void {
  if (!canUseBrowserStorage()) return;
  document.cookie = buildClearedRememberCookie({ secure: browserSecure() });
}

export function ownerAuthStorage(
  base: MaybeAsyncStorage | undefined,
): MaybeAsyncStorage | undefined {
  if (typeof window === "undefined") return base;
  return wrapOwnerSessionStorage(base, {
    persistEnabled: readOwnerSessionPersist,
    local: window.localStorage,
    session: window.sessionStorage,
    onPersistSession: writeRememberCookieFromSessionJson,
    onClearSession: clearRememberCookie,
  });
}
