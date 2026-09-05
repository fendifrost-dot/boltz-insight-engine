import {
  OWNER_SESSION_ACTIVE_KEY,
  OWNER_SESSION_MANUAL_SIGNOUT_KEY,
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

export function markManualSignOut(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(OWNER_SESSION_MANUAL_SIGNOUT_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

export function clearManualSignOut(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.removeItem(OWNER_SESSION_MANUAL_SIGNOUT_KEY);
  } catch {
    /* storage blocked */
  }
}

export function hasManualSignOut(): boolean {
  if (!canUseBrowserStorage()) return false;
  try {
    return window.sessionStorage.getItem(OWNER_SESSION_MANUAL_SIGNOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function ownerAuthStorage(
  base: MaybeAsyncStorage | undefined,
): MaybeAsyncStorage | undefined {
  if (typeof window === "undefined") return base;
  return wrapOwnerSessionStorage(base, {
    local: window.localStorage,
    session: window.sessionStorage,
  });
}
