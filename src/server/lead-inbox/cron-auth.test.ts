import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeEqual } from "./env.server.ts";

// cron.server.ts reaches Supabase on import, so authorizeCron is asserted
// statically here (same approach as server-capability-gates.test.ts) while the
// pure comparison helper is exercised directly.

const here = dirname(fileURLToPath(import.meta.url));
const cronSource = readFileSync(join(here, "cron.server.ts"), "utf8");
const envSource = readFileSync(join(here, "env.server.ts"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const cronCode = stripComments(cronSource);
const envCode = stripComments(envSource);

test("readSecret trims the stored secret", () => {
  assert.match(envCode, /return value\.trim\(\)/, "readSecret should trim stored values");
});

test("authorizeCron trims the presented bearer token to match the stored secret", () => {
  // The bug this guards: readSecret trims, so an untrimmed token can never
  // match a secret whose shell value carries a trailing newline.
  assert.match(
    cronCode,
    /header\.slice\(7\)\.trim\(\)/,
    "the presented bearer token must be trimmed, since readSecret trims the stored value",
  );
});

test("authorizeCron distinguishes an unconfigured secret from a bad token", () => {
  // A 503 means no secret on the server; a 401 means the token did not match.
  // Collapsing them would make a deploy problem indistinguishable from a typo.
  assert.match(cronCode, /Cron secret not configured[\s\S]*?status: 503/);
  assert.match(cronCode, /Unauthorized[\s\S]*?status: 401/);
  const notConfigured = cronCode.indexOf("Cron secret not configured");
  const unauthorized = cronCode.indexOf("Unauthorized");
  assert.ok(notConfigured < unauthorized, "the 503 check must precede the 401 check");
});

test("authorizeCron rejects an empty or non-Bearer authorization header", () => {
  assert.match(cronCode, /startsWith\("Bearer "\)/, "only the Bearer scheme is accepted");
  assert.match(cronCode, /!token \|\|/, "an empty token must be rejected before comparison");
});

test("safeEqual rejects a token differing only by trailing whitespace", () => {
  // Demonstrates why the trim above is required rather than cosmetic.
  assert.equal(safeEqual("s3cret-value", "s3cret-value\n"), false);
  assert.equal(safeEqual("s3cret-value", "s3cret-value "), false);
  assert.equal(safeEqual("s3cret-value\n".trim(), "s3cret-value"), true);
});

test("safeEqual is length-guarded and value-exact", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});

test("CRON_SECRET falls back to the Lovable-managed name", () => {
  // Load-bearing for diagnosis: a 401 (not 503) proves one of these two is set,
  // but not which. If only LOVABLE_CRON_SECRET is provisioned, the server
  // authenticates against a value that is not in the project's own secrets.
  assert.match(envCode, /LOVABLE_CRON_SECRET/, "the fallback name must be read");
  const primary = envCode.indexOf("process.env[name]");
  const fallback = envCode.indexOf("LOVABLE_CRON_SECRET");
  assert.ok(primary < fallback, "an explicitly set CRON_SECRET must win over the fallback");
});
