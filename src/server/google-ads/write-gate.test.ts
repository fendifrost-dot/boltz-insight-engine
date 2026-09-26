import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adsWriteGate, ADS_WRITES_FLAG } from "./env.server.ts";

// client.server.ts cannot be imported under bare node (extensionless imports),
// so its wiring is asserted statically; the gate itself is pure and tested directly.

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "client.server.ts"), "utf8");
const envSource = readFileSync(join(here, "env.server.ts"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const clientCode = stripComments(clientSource);
const envCode = stripComments(envSource);

// --- Fails closed ------------------------------------------------------------

test("an unset flag blocks live writes", () => {
  const gate = adsWriteGate({});
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /disabled/i);
});

test("the blocked reason names the flag an operator must set", () => {
  assert.match(adsWriteGate({}).reason, new RegExp(ADS_WRITES_FLAG));
});

test("only a deliberate 'true' opens the gate", () => {
  for (const value of ["true", "TRUE", "True", " true ", "\ttrue\n"]) {
    assert.equal(
      adsWriteGate({ [ADS_WRITES_FLAG]: value }).allowed,
      true,
      `expected open: ${JSON.stringify(value)}`,
    );
  }
});

test("near-miss values stay closed rather than being guessed at", () => {
  for (const value of [
    "1",
    "yes",
    "on",
    "enabled",
    "",
    " ",
    "false",
    "no",
    "0",
    "truthy",
    "true-ish",
  ]) {
    assert.equal(
      adsWriteGate({ [ADS_WRITES_FLAG]: value }).allowed,
      false,
      `expected closed: ${JSON.stringify(value)}`,
    );
  }
});

test("an unrelated variable does not open the gate", () => {
  assert.equal(
    adsWriteGate({ GOOGLE_ADS_WRITES: "true", ADS_WRITES_ENABLED: "true" }).allowed,
    false,
  );
});

// --- Cannot lapse with time --------------------------------------------------

test("the gate has no time dependence at all", () => {
  // This is the whole point of the replacement: the previous control was a date
  // constant that stopped protecting on a schedule, with nobody deciding it should.
  const gateBlock = envCode.slice(envCode.indexOf("export function adsWriteGate"));
  for (const timeish of ["Date.now", "Date.parse", "new Date", "getTime"]) {
    assert.ok(!gateBlock.includes(timeish), `the gate must not reference ${timeish}`);
  }
});

test("the expired time-based freeze is fully gone", () => {
  for (const dead of ["ADS_WRITE_FREEZE_UNTIL", "adsWriteFreezeActive"]) {
    assert.ok(!clientCode.includes(dead), `${dead} should no longer exist`);
    assert.ok(!envCode.includes(dead), `${dead} should no longer exist`);
  }
});

// --- Wiring into adsMutate ---------------------------------------------------

test("adsMutate refuses an unconfirmed write before consulting the gate", () => {
  const mutate = clientCode.slice(clientCode.indexOf("export async function adsMutate"));
  const confirmIdx = mutate.indexOf("opts.confirmed");
  const gateIdx = mutate.indexOf("adsWriteGate()");
  assert.ok(confirmIdx >= 0, "missing confirmation check");
  assert.ok(gateIdx >= 0, "missing write-gate check");
  assert.ok(confirmIdx < gateIdx, "confirmation must be checked first");
});

test("adsMutate consults the gate before issuing any request", () => {
  const mutate = clientCode.slice(clientCode.indexOf("export async function adsMutate"));
  const gateIdx = mutate.indexOf("adsWriteGate()");
  const fetchIdx = mutate.indexOf("fetch(");
  assert.ok(gateIdx >= 0 && fetchIdx >= 0);
  assert.ok(gateIdx < fetchIdx, "the gate must be checked before the HTTP call");
});

test("a blocked gate still permits validateOnly dry runs", () => {
  const mutate = clientCode.slice(clientCode.indexOf("export async function adsMutate"));
  assert.match(
    mutate,
    /!gate\.allowed && !opts\.validateOnly/,
    "dry runs must remain permitted while live writes are blocked",
  );
});

test("a blocked gate returns its own reason rather than a generic message", () => {
  const mutate = clientCode.slice(clientCode.indexOf("export async function adsMutate"));
  assert.match(
    mutate,
    /reason: gate\.reason/,
    "the operator-actionable reason must reach the caller",
  );
});

// --- The flag is a switch, not a secret --------------------------------------

test("the write flag is not reported as a secret", () => {
  // adsSecretStatus() enumerates ADS_SECRET_NAMES; a deployment switch appearing
  // there would read as a missing credential.
  const namesBlock = envCode.slice(
    envCode.indexOf("export const ADS_SECRET_NAMES"),
    envCode.indexOf("export const ADS_OPTIONAL_SECRETS"),
  );
  assert.ok(
    !namesBlock.includes(ADS_WRITES_FLAG),
    "the write flag must not be in ADS_SECRET_NAMES",
  );
});

test("configuring the flag does not affect read-path config validation", () => {
  // adsConfigError covers credentials only; enabling or disabling writes must
  // never make the weekly report stop working.
  const start = envCode.indexOf("export function adsConfigError");
  assert.ok(start >= 0, "adsConfigError not found");
  // Bound to this function's own body — the next top-level export, or EOF.
  const next = envCode.indexOf("\nexport ", start + 1);
  const configBlock = envCode.slice(start, next >= 0 ? next : undefined);
  assert.ok(configBlock.includes("ADS_SECRET_NAMES"), "expected the credential check");
  assert.ok(!configBlock.includes(ADS_WRITES_FLAG), "the write flag must not gate reads");
});
