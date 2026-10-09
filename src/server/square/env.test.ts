import test from "node:test";
import assert from "node:assert/strict";
import {
  displayApplicationId,
  readSquareConfig,
  squareEnvironment,
  squareNotificationUrl,
  squareSecretStatus,
} from "./env.server.ts";
import { SQUARE_PRODUCTION_BASE, SQUARE_SANDBOX_BASE } from "./version.ts";

const NAMES = [
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_APPLICATION_ID",
  "SQUARE_ENVIRONMENT",
  "SQUARE_LOCATION_ID",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "PUBLIC_APP_URL",
] as const;

function restore(previous: Record<string, string | undefined>) {
  for (const name of NAMES) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("Square defaults to production and stays unconfigured without a token", () => {
  const previous = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  try {
    for (const name of NAMES) delete process.env[name];
    assert.deepEqual(squareEnvironment(), { ok: true, value: "production" });
    const missing = readSquareConfig();
    assert.equal(missing.configured, false);
    if (!missing.configured) assert.match(missing.reason, /SQUARE_ACCESS_TOKEN/);

    process.env["SQUARE_ACCESS_TOKEN"] = "EAAAprod-token";
    process.env["SQUARE_APPLICATION_ID"] = "sq0idp-example";
    const production = readSquareConfig();
    assert.equal(production.configured, true);
    if (production.configured) {
      assert.equal(production.environment, "production");
      assert.equal(production.baseUrl, SQUARE_PRODUCTION_BASE);
      assert.equal(production.applicationId, "sq0idp-example");
      assert.equal(production.signatureKey, null);
    }

    process.env["SQUARE_ENVIRONMENT"] = "sandbox";
    const sandbox = readSquareConfig();
    assert.equal(sandbox.configured, true);
    if (sandbox.configured) assert.equal(sandbox.baseUrl, SQUARE_SANDBOX_BASE);

    process.env["SQUARE_ENVIRONMENT"] = "prod";
    const invalid = readSquareConfig();
    assert.equal(invalid.configured, false);

    process.env["PUBLIC_APP_URL"] = "https://boltz-insight-engine.lovable.app/";
    assert.equal(
      squareNotificationUrl(),
      "https://boltz-insight-engine.lovable.app/api/public/square/webhook",
    );
    assert.equal(displayApplicationId("sq0idp-example", "EAAAprod-token"), "sq0idp-example");
    assert.equal(displayApplicationId("EAAAprod-token", "EAAAprod-token"), null);

    const status = squareSecretStatus();
    const token = status.find((row) => row.name === "SQUARE_ACCESS_TOKEN");
    assert.equal(token?.masked, null);
    assert.equal(JSON.stringify(status).includes("EAAAprod-token"), false);
  } finally {
    restore(previous);
  }
});
