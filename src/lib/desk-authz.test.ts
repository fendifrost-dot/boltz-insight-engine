import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCapabilityWithProbe } from "../server/authz/capabilities.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "lib/desk.functions.ts"), "utf8");
const detail = readFileSync(join(root, "routes/_authenticated/desk/leads/$leadId.tsx"), "utf8");
const form = readFileSync(join(root, "routes/_authenticated/desk/new.tsx"), "utf8");

function handlerBlock(exportName: string): string {
  const start = source.indexOf(`export const ${exportName} = createServerFn`);
  assert.ok(start >= 0, `missing export ${exportName}`);
  const next = source.indexOf("\nexport const ", start + 1);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

const HANDLERS = [
  "createDeskLead",
  "listDeskLeads",
  "getDeskLead",
  "addDeskNote",
  "setDeskAttribution",
  "linkDeskGoogleAdsCall",
] as const;

test("every desk handler requires a signed-in user before capability checks", () => {
  for (const name of HANDLERS) {
    const block = handlerBlock(name);
    assert.match(block, /requireSupabaseAuth/);
    const cap = block.indexOf("requireCapability(");
    assert.ok(cap >= 0, `${name} missing requireCapability`);
    const admin = block.indexOf("client.server");
    const table = block.indexOf('.from("leads")');
    if (admin >= 0) assert.ok(cap < admin, `${name} capability must run before service role`);
    if (table >= 0) assert.ok(cap < table, `${name} capability must run before lead access`);
  }
});

test("desk writes and reads use staff capabilities and never mark Paid", () => {
  assert.match(handlerBlock("createDeskLead"), /requireCapability\(context, "contacts.write"\)/);
  assert.match(handlerBlock("addDeskNote"), /requireCapability\(context, "contacts.write"\)/);
  assert.match(handlerBlock("listDeskLeads"), /requireCapability\(context, "contacts.read"\)/);
  assert.match(handlerBlock("getDeskLead"), /requireCapability\(context, "contacts.read"\)/);
  assert.match(
    handlerBlock("setDeskAttribution"),
    /requireCapability\(context, "attribution.correct"\)/,
  );
  assert.match(
    handlerBlock("linkDeskGoogleAdsCall"),
    /requireCapability\(context, "attribution.correct"\)/,
  );
  assert.doesNotMatch(source, /lifecycle:\s*"Paid"/);
  assert.doesNotMatch(source, /toLifecycle:\s*"Paid"/);
  assert.doesNotMatch(source, /console\.(log|error|info|warn)\([^)]*\$\{/);
  assert.doesNotMatch(source, /error\.message/);
  assert.doesNotMatch(detail, /sendOwnerMessage|startOwnerSms/);
  assert.doesNotMatch(form, /sendOwnerMessage|startOwnerSms/);
  assert.match(detail, /Payments update automatically/);
});

test("staff can record leads and an anonymous probe cannot", async () => {
  const staff = { isStaff: async () => true, isOwner: async () => false };
  const anon = { isStaff: async () => false, isOwner: async () => false };
  const owner = { isStaff: async () => true, isOwner: async () => true };
  assert.equal(await checkCapabilityWithProbe(staff, "contacts.write"), true);
  assert.equal(await checkCapabilityWithProbe(staff, "contacts.read"), true);
  assert.equal(await checkCapabilityWithProbe(staff, "attribution.correct"), true);
  assert.equal(await checkCapabilityWithProbe(staff, "cases.transition"), true);
  assert.equal(await checkCapabilityWithProbe(staff, "financial_status.confirm"), false);
  assert.equal(await checkCapabilityWithProbe(staff, "integrations.manage"), false);
  assert.equal(await checkCapabilityWithProbe(anon, "contacts.read"), false);
  assert.equal(await checkCapabilityWithProbe(anon, "contacts.write"), false);
  assert.equal(await checkCapabilityWithProbe(owner, "financial_status.confirm"), true);
  assert.equal(await checkCapabilityWithProbe(owner, "contacts.write"), true);
});
