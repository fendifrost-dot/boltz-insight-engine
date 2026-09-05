import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OWNER_REFRESH_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  OWNER_SESSION_PERSIST_KEY,
  buildClearedRememberCookie,
  buildRememberCookie,
  extractRefreshToken,
  isTransientAuthError,
  nextAuthResolveStep,
  ownerAuthAfterLaunch,
  parseRememberCookie,
  persistPreferenceEnabled,
  sessionNeedsRefresh,
  shouldDiscardEphemeralSession,
  simulatedBrowserRestart,
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

const here = dirname(fileURLToPath(import.meta.url));

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

test("signed-in owner stays authenticated after a simulated Chrome crash/restart", () => {
  const restarted = simulatedBrowserRestart({
    persistEnabled: true,
    hasPersistedSession: true,
    accessTokenExpired: true,
  });
  assert.equal(restarted.hasActiveMarker, false, "sessionStorage dies with the process");

  const decision = ownerAuthAfterLaunch({
    ...restarted,
    hasAuthCallback: false,
  });
  assert.deepEqual(decision, { outcome: "refresh-then-allow" });

  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: false,
      expiresAtSeconds: 1,
      nowMs: 120_000,
    }),
    { action: "refresh" },
  );
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: true,
      expiresAtSeconds: 9_999_999,
      nowMs: 0,
      alreadyRefreshed: true,
    }),
    { action: "allow" },
  );
});

test("stay-signed-in off expires after a simulated browser restart", () => {
  const restarted = simulatedBrowserRestart({
    persistEnabled: false,
    hasPersistedSession: true,
    accessTokenExpired: false,
  });
  const decision = ownerAuthAfterLaunch({
    ...restarted,
    hasAuthCallback: false,
  });
  assert.deepEqual(decision, { outcome: "redirect-auth", reason: "ephemeral-expired" });
});

test("cold Chrome open with empty localStorage still recovers from the remember cookie", () => {
  const restarted = simulatedBrowserRestart({
    persistEnabled: true,
    hasPersistedSession: false,
    hasRememberCookie: true,
  });
  assert.equal(restarted.hasActiveMarker, false);
  assert.deepEqual(
    ownerAuthAfterLaunch({
      ...restarted,
      hasAuthCallback: false,
    }),
    { outcome: "refresh-then-allow" },
  );
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: false,
      hasUser: false,
      hasRememberToken: true,
      nowMs: 0,
    }),
    { action: "restore-cookie" },
  );
});

test("unauthenticated users still hit /auth", () => {
  const decision = ownerAuthAfterLaunch({
    persistEnabled: true,
    hasActiveMarker: false,
    hasAuthCallback: false,
    hasPersistedSession: false,
    accessTokenExpired: false,
  });
  assert.deepEqual(decision, { outcome: "redirect-auth", reason: "unauthenticated" });
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: false,
      hasUser: false,
      nowMs: 0,
    }),
    { action: "redirect-auth" },
  );
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

test("resolve step refreshes an expired session before sending the owner to /auth", () => {
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: false,
      expiresAtSeconds: 1,
      nowMs: 120_000,
    }),
    { action: "refresh" },
  );
  assert.deepEqual(
    nextAuthResolveStep({
      hasSession: true,
      hasUser: false,
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
      expiresAtSeconds: 9_999_999,
      nowMs: 0,
      alreadyRefreshed: true,
      getUserError: { message: "Failed to fetch", status: 0 },
    }),
    { action: "allow-stale" },
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

  await wrapped.removeItem("sb-auth");
  assert.equal(local.getItem("sb-auth"), null);
  assert.ok(events.includes("clear"));
});

test("storage wrap falls back across stores so a leftover session can recover", async () => {
  const local = memoryStore();
  const session = memoryStore({ "sb-auth": "from-session" });
  const base = memoryStore();
  const wrapped = wrapOwnerSessionStorage(base, { local, session });
  assert.ok(wrapped);
  assert.equal(await wrapped.getItem("sb-auth"), "from-session");
});

test("magic-link callback query/hash is detected before the auth gate", () => {
  assert.equal(urlHasAuthCallback("?code=abc", ""), true);
  assert.equal(urlHasAuthCallback("token_hash=xyz&type=email", ""), true);
  assert.equal(urlHasAuthCallback("", "#access_token=jwt&refresh_token=rt"), true);
  assert.equal(urlHasAuthCallback("", ""), false);
  assert.equal(urlHasAuthCallback("?foo=1", "#bar=2"), false);
});

test("authenticated route recovers the owner instead of treating getUser failure as logout", () => {
  const route = readFileSync(join(here, "../routes/_authenticated/route.tsx"), "utf8");
  assert.match(route, /resolveOwnerUserWithAgentRestore/);
  assert.match(route, /throw redirect\(\{ to: "\/auth" \}\)/);
  assert.doesNotMatch(route, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(route, /signOut/);
});

test("auth page defaults stay-signed-in on and does not open public signup", () => {
  const auth = readFileSync(join(here, "../routes/auth.tsx"), "utf8");
  assert.match(auth, /staySignedIn/);
  assert.match(auth, /useState\(true\)/);
  assert.match(auth, /shouldCreateUser: false/);
  assert.match(auth, /Stay signed in/);
});
