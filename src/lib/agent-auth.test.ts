import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickSessionTokens,
  publicSignInErrorMessage,
  sessionPayloadHasSecrets,
  RECOMMENDED_AGENT_EMAIL,
} from "./agent-auth.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("recommended agent mailbox matches the existing Boltz domain", () => {
  assert.equal(RECOMMENDED_AGENT_EMAIL, "agents@boltzautoinc.com");
});

test("public sign-in errors never echo raw provider text or passwords", () => {
  assert.equal(
    publicSignInErrorMessage("Invalid login credentials"),
    "Sign-in failed. Check the email and password.",
  );
  assert.equal(
    publicSignInErrorMessage("password is hunter2"),
    "Sign-in failed. Check the email and password.",
  );
  assert.match(publicSignInErrorMessage("Email not confirmed"), /not confirmed/);
  assert.match(publicSignInErrorMessage("too many requests"), /Too many/);
});

test("session picker returns only token fields", () => {
  const tokens = pickSessionTokens({
    access_token: "at",
    refresh_token: "rt",
    expires_at: 99,
    expires_in: 3600,
    token_type: "bearer",
  });
  assert.deepEqual(tokens, {
    access_token: "at",
    refresh_token: "rt",
    expires_at: 99,
    expires_in: 3600,
    token_type: "bearer",
  });
  assert.equal(sessionPayloadHasSecrets(tokens), false);
  assert.equal(sessionPayloadHasSecrets({ password: "secret" }), true);
  assert.equal(pickSessionTokens({ access_token: "at" }), null);
});

test("agent login server path never logs or returns the password secret", () => {
  const server = readFileSync(join(here, "../server/authz/agent-login.server.ts"), "utf8");
  assert.match(server, /AGENT_AUTH_EMAIL/);
  assert.match(server, /AGENT_AUTH_PASSWORD/);
  assert.match(server, /signInWithPassword/);
  assert.match(server, /is_staff/);
  assert.match(server, /read_agent_auth_secret/);
  assert.match(server, /resolveAgentAuthCredentials/);
  assert.doesNotMatch(server, /console\.(log|info|debug|error|warn)\([^)]*PASSWORD/);
  assert.doesNotMatch(server, /return \{ ok: true[^}]*\bpassword\s*:/);
});

test("env example documents agent secrets without values", () => {
  const env = readFileSync(join(here, "../../.env.example"), "utf8");
  assert.match(env, /^AGENT_AUTH_EMAIL=$/m);
  assert.match(env, /^AGENT_AUTH_PASSWORD=$/m);
  assert.doesNotMatch(env, /AGENT_AUTH_PASSWORD=.+/);
});

test("persistent session restore reads the HttpOnly remember cookie on the server", () => {
  const remember = readFileSync(join(here, "../server/authz/remember-cookie.server.ts"), "utf8");
  const fns = readFileSync(join(here, "agent-auth.functions.ts"), "utf8");
  const route = readFileSync(join(here, "../routes/_authenticated/route.tsx"), "utf8");
  assert.match(remember, /httpOnly:\s*true/);
  assert.match(remember, /getCookie/);
  assert.match(remember, /refreshSession/);
  assert.match(remember, /signInWithStoredAgentCredentials/);
  assert.doesNotMatch(remember, /console\.(log|info|debug|error|warn)\(/);
  assert.match(fns, /restorePersistentShopSession/);
  assert.match(route, /restorePersistentShopSession/);
  const auth = readFileSync(join(here, "../routes/auth.tsx"), "utf8");
  assert.match(auth, /useServerFn\(restorePersistentShopSession\)/);
  assert.match(auth, /useServerFn\(signInShopAgent\)/);
});

test("shop-agent nav hides owner-only banking and settings surfaces", () => {
  const shell = readFileSync(join(here, "../components/ops/Shell.tsx"), "utf8");
  assert.match(shell, /ownerOnly: true/);
  assert.match(shell, /\/integration-health/);
  assert.match(shell, /\/ads/);
  assert.match(shell, /getMyAccess/);
});
