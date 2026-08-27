import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_REFRESH_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  OWNER_SESSION_PERSIST_KEY,
  buildClearedRememberCookie,
  buildRememberCookie,
  extractRefreshToken,
  isTransientAuthError,
  nextAuthResolveStep,
  parseRememberCookie,
  persistPreferenceEnabled,
  sessionNeedsRefresh,
  shouldDiscardEphemeralSession,
  urlHasAuthCallback,
  wrapOwnerSessionStorage,
  writePersistPreference,
} from "./owner-session.ts";

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
}

test("stay-signed-in defaults to on unless explicitly disabled", () => {
  assert.equal(
    persistPreferenceEnabled(() => null),
    true,
  );
  assert.equal(
    persistPreferenceEnabled(() => "1"),
    true,
  );
  assert.equal(
    persistPreferenceEnabled(() => "0"),
    false,
  );
  assert.equal(
    persistPreferenceEnabled(() => "false"),
    false,
  );
});

test("writePersistPreference stores a stable flag", () => {
  const storage = memoryStore();
  writePersistPreference(storage, true);
  assert.equal(storage.getItem(OWNER_SESSION_PERSIST_KEY), "1");
  writePersistPreference(storage, false);
  assert.equal(storage.getItem(OWNER_SESSION_PERSIST_KEY), "0");
});

test("extractRefreshToken reads supabase session JSON shapes", () => {
  assert.equal(extractRefreshToken("{not json"), null);
  assert.equal(extractRefreshToken(JSON.stringify({ access_token: "a" })), null);
  assert.equal(
    extractRefreshToken(JSON.stringify({ refresh_token: "rt-1", access_token: "a" })),
    "rt-1",
  );
  assert.equal(
    extractRefreshToken(JSON.stringify({ currentSession: { refresh_token: "rt-2" } })),
    "rt-2",
  );
});

test("remember-me cookie is first-party, Lax, and long-lived", () => {
  const cookie = buildRememberCookie("rt/value+1", {
    secure: true,
    maxAgeSeconds: OWNER_SESSION_MAX_AGE_SECONDS,
  });
  assert.match(cookie, new RegExp(`^${OWNER_REFRESH_COOKIE}=`));
  assert.match(cookie, /Max-Age=5184000/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.equal(parseRememberCookie(cookie), "rt/value+1");
  assert.equal(parseRememberCookie(`${OWNER_REFRESH_COOKIE}=; Path=/`), null);

  const cleared = buildClearedRememberCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
  assert.equal(parseRememberCookie(`other=1; ${OWNER_REFRESH_COOKIE}=abc-token`), "abc-token");
});

test("sessionNeedsRefresh uses a 60s skew", () => {
  assert.equal(sessionNeedsRefresh(undefined, 1_000), true);
  assert.equal(sessionNeedsRefresh(100, 100_000, 0), true);
  assert.equal(sessionNeedsRefresh(100, 40_000, 60_000), true);
  assert.equal(sessionNeedsRefresh(200, 100_000, 60_000), false);
});

test("transient auth errors do not look like a signed-out owner", () => {
  assert.equal(isTransientAuthError(null), false);
  assert.equal(isTransientAuthError({ message: "Invalid Refresh Token" }), false);
  assert.equal(isTransientAuthError({ message: "Failed to fetch", status: 0 }), true);
  assert.equal(isTransientAuthError({ message: "timeout", status: 503 }), true);
  assert.equal(isTransientAuthError({ status: 500, message: "Auth retry" }), true);
});

test("resolve step restores from cookie when local session is missing", () => {
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: false,
      hasUser: false,
      hasRememberToken: true,
      nowMs: 0,
    }),
    { action: "restore-cookie" },
  );
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: false,
      hasUser: false,
      hasRememberToken: true,
      alreadyRestored: true,
      nowMs: 0,
    }),
    { action: "redirect-auth" },
  );
});

test("resolve step refreshes an expired session before sending the owner to /auth", () => {
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: false,
      hasRememberToken: false,
      expiresAtSeconds: 1,
      nowMs: 120_000,
    }),
    { action: "refresh" },
  );
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: false,
      hasRememberToken: false,
      expiresAtSeconds: 1,
      nowMs: 120_000,
      alreadyRefreshed: true,
      getUserError: { message: "Invalid JWT" },
    }),
    { action: "redirect-auth" },
  );
});

test("resolve step allows a cached session through a transient getUser failure", () => {
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: false,
      hasRememberToken: true,
      expiresAtSeconds: 9_999_999,
      nowMs: 0,
      alreadyRefreshed: true,
      getUserError: { message: "Failed to fetch", status: 0 },
    }),
    { action: "allow-stale" },
  );
});

test("storage wrap writes localStorage and a cookie when stay-signed-in is on", async () => {
  const local = memoryStore();
  const session = memoryStore();
  const base = memoryStore();
  const events: string[] = [];
  const wrapped = wrapOwnerSessionStorage(base, {
    persistEnabled: () => true,
    local,
    session,
    onPersistSession: (value) => events.push(`persist:${extractRefreshToken(value)}`),
    onClearSession: () => events.push("clear"),
  });
  assert.ok(wrapped);
  const payload = JSON.stringify({ refresh_token: "rt-live", access_token: "a" });
  await wrapped.setItem("sb-auth", payload);
  assert.equal(local.getItem("sb-auth"), payload);
  assert.equal(base.getItem("sb-auth"), payload);
  assert.deepEqual(events, ["persist:rt-live"]);
});

test("storage wrap still uses localStorage for PKCE when stay-signed-in is off", async () => {
  const local = memoryStore();
  const session = memoryStore();
  const base = memoryStore();
  const events: string[] = [];
  const wrapped = wrapOwnerSessionStorage(base, {
    persistEnabled: () => false,
    local,
    session,
    onPersistSession: () => events.push("persist"),
    onClearSession: () => events.push("clear"),
  });
  assert.ok(wrapped);
  const payload = JSON.stringify({ refresh_token: "rt-temp" });
  await wrapped.setItem("sb-auth", payload);
  assert.equal(local.getItem("sb-auth"), payload);
  assert.equal(base.getItem("sb-auth"), payload);
  assert.deepEqual(events, ["clear"]);

  await wrapped.removeItem("sb-auth");
  assert.equal(local.getItem("sb-auth"), null);
  assert.ok(events.includes("clear"));
});

test("ephemeral sessions are discarded on a new browser open, not during magic-link return", () => {
  assert.equal(
    shouldDiscardEphemeralSession({
      persistEnabled: true,
      hasActiveMarker: false,
      hasAuthCallback: false,
    }),
    false,
  );
  assert.equal(
    shouldDiscardEphemeralSession({
      persistEnabled: false,
      hasActiveMarker: true,
      hasAuthCallback: false,
    }),
    false,
  );
  assert.equal(
    shouldDiscardEphemeralSession({
      persistEnabled: false,
      hasActiveMarker: false,
      hasAuthCallback: true,
    }),
    false,
  );
  assert.equal(
    shouldDiscardEphemeralSession({
      persistEnabled: false,
      hasActiveMarker: false,
      hasAuthCallback: false,
    }),
    true,
  );
});

test("magic-link callback query/hash is detected before the auth gate", () => {
  assert.equal(urlHasAuthCallback("?code=abc", ""), true);
  assert.equal(urlHasAuthCallback("token_hash=xyz&type=email", ""), true);
  assert.equal(urlHasAuthCallback("", "#access_token=jwt&refresh_token=rt"), true);
  assert.equal(urlHasAuthCallback("", ""), false);
  assert.equal(urlHasAuthCallback("?foo=1", "#bar=2"), false);
});

test("storage wrap falls back across stores so a leftover session can recover", async () => {
  const local = memoryStore();
  const session = memoryStore({ "sb-auth": "from-session" });
  const base = memoryStore();
  const wrapped = wrapOwnerSessionStorage(base, {
    persistEnabled: () => true,
    local,
    session,
  });
  assert.ok(wrapped);
  assert.equal(await wrapped.getItem("sb-auth"), "from-session");
});
