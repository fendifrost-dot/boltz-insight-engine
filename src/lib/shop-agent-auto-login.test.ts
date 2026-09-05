import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldAutoLoginShopAgent } from "./shop-agent-auto-login.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("Grok auto-login runs only when stay-signed-in is on, secrets exist, and there is no session", () => {
  assert.equal(
    shouldAutoLoginShopAgent({
      persistEnabled: true,
      hasSession: false,
      secretsConfigured: true,
      manualSignOut: false,
    }),
    true,
  );
  assert.equal(
    shouldAutoLoginShopAgent({
      persistEnabled: true,
      hasSession: true,
      secretsConfigured: true,
      manualSignOut: false,
    }),
    false,
  );
  assert.equal(
    shouldAutoLoginShopAgent({
      persistEnabled: false,
      hasSession: false,
      secretsConfigured: true,
      manualSignOut: false,
    }),
    false,
  );
  assert.equal(
    shouldAutoLoginShopAgent({
      persistEnabled: true,
      hasSession: false,
      secretsConfigured: false,
      manualSignOut: false,
    }),
    false,
  );
});

test("explicit Sign out in this tab blocks silent auto-login", () => {
  assert.equal(
    shouldAutoLoginShopAgent({
      persistEnabled: true,
      hasSession: false,
      secretsConfigured: true,
      manualSignOut: true,
    }),
    false,
  );
});

test("session restore and auth page call silent shop-agent login", () => {
  const browser = readFileSync(join(here, "owner-session.browser.ts"), "utf8");
  assert.match(browser, /tryAutoLoginShopAgent/);
  assert.match(browser, /markManualSignOut/);
  const auth = readFileSync(join(here, "../routes/auth.tsx"), "utf8");
  assert.match(auth, /tryAutoLoginShopAgent/);
  assert.match(auth, /Signing Grok \/ shop agent back in/);
});
