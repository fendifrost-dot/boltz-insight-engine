import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeFieldData, resolvePlatform } from "./normalize.ts";
import { authorizeMakeLeadIntake, graphPartsFromInbound, parseMakeLeadBody } from "./make-lead.ts";

const SECRET = "test-make-intake-secret";
const LEAD_ID = "2283654155812202";

const ARRAY_BODY = {
  id: LEAD_ID,
  created_time: "2026-11-03T18:04:00+0000",
  page_id: "101035642014297",
  form_id: "999",
  form_name: "Estimate",
  ad_id: "111",
  ad_name: "Brake ad",
  adset_id: "333",
  adset_name: "Ad set",
  campaign_id: "222",
  campaign_name: "Winter",
  platform: "ig",
  field_data: [
    { name: "full_name", values: ["Dana Lee"] },
    { name: "email", values: "dana@example.com" },
    { name: "phone_number", values: ["312-555-0101"] },
    { name: "what_year,_make_and_model_is_your_vehicle?", values: ["2014 Honda Accord EX"] },
  ],
};

const FLAT_BODY = {
  id: LEAD_ID,
  created_time: "2026-11-03T18:04:00+0000",
  page_id: "101035642014297",
  form: { id: "999", name: "Estimate" },
  ad_id: "111",
  ad_name: "Brake ad",
  adset_id: "333",
  campaign: { id: "222", name: "Winter" },
  platform: "ig",
  full_name: "Dana Lee",
  email: "dana@example.com",
  phone_number: "312-555-0101",
  "what_year,_make_and_model_is_your_vehicle?": "2014 Honda Accord EX",
};

test("make intake auth is a constant-time bearer check and fails closed", () => {
  const source = readFileSync(new URL("./make-lead.ts", import.meta.url), "utf8");
  assert.match(source, /secretEqual\(token, secret\)/);
  assert.equal(authorizeMakeLeadIntake(`Bearer ${SECRET}`, undefined)?.status, 503);
  assert.equal(authorizeMakeLeadIntake(null, undefined)?.status, 503);
  assert.equal(authorizeMakeLeadIntake(null, SECRET)?.status, 401);
  assert.equal(authorizeMakeLeadIntake("Basic " + SECRET, SECRET)?.status, 401);
  assert.equal(authorizeMakeLeadIntake("Bearer wrong-value", SECRET)?.status, 401);
  assert.equal(authorizeMakeLeadIntake("Bearer short", SECRET)?.status, 401);
  assert.equal(authorizeMakeLeadIntake(`Bearer  ${SECRET}  `, SECRET), null);
  assert.equal(authorizeMakeLeadIntake(`Bearer ${SECRET}`, SECRET), null);
});

test("the make route checks the bearer before it parses or ingests, and never calls Graph", () => {
  const route = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../routes/api/public/intake/make-lead.ts"),
    "utf8",
  );
  const auth = route.indexOf("authorizeMakeLeadIntake(");
  const parse = route.indexOf("JSON.parse(");
  const ingest = route.indexOf("ingestMetaLead(");
  assert.ok(auth >= 0 && parse > auth && ingest > parse);
  assert.match(route, /method: "MAKE"/);
  assert.match(route, /skipGraph: true/);
  assert.match(route, /metaLeadId: parsed\.lead\.metaLeadId/);
  assert.doesNotMatch(
    route,
    /getLead\(|getForm\(|pageAccessTokenFor\(|sendOutbound|sendSms|processJobs/,
  );
  assert.match(route, /duplicate: outcome\.status === "duplicate"/);
});

test("field_data array and flattened key/value pairs map the same lead", () => {
  const fromArray = parseMakeLeadBody(ARRAY_BODY);
  const fromFlat = parseMakeLeadBody(FLAT_BODY);
  assert.equal(fromArray.ok, true);
  assert.equal(fromFlat.ok, true);
  if (!fromArray.ok || !fromFlat.ok) return;
  assert.equal(fromArray.lead.metaLeadId, LEAD_ID);
  assert.equal(fromFlat.lead.metaLeadId, LEAD_ID, "same Meta lead id is the dedupe key");
  assert.equal(fromArray.lead.formName, "Estimate");
  assert.equal(fromFlat.lead.formId, "999");
  assert.equal(fromFlat.lead.campaignName, "Winter");
  assert.equal(fromArray.lead.pageId, "101035642014297");
  assert.equal(resolvePlatform(fromArray.lead.platform), "instagram");
  const left = normalizeFieldData(fromArray.lead.fieldData);
  const right = normalizeFieldData(fromFlat.lead.fieldData);
  assert.equal(left.name, "Dana Lee");
  assert.equal(left.email, "dana@example.com");
  assert.equal(left.phone_e164, "+13125550101");
  assert.equal(left.vehicle_year, 2014);
  assert.equal(left.vehicle_make, "Honda");
  assert.deepEqual(left, right);
  const parts = graphPartsFromInbound(fromArray.lead);
  assert.equal(parts.lead.id, LEAD_ID);
  assert.equal(parts.form?.name, "Estimate");
});

test("a stringified field_data array and a field_data object are accepted", () => {
  const stringified = parseMakeLeadBody({
    leadgen_id: LEAD_ID,
    field_data: JSON.stringify([{ name: "email", values: ["dana@example.com"] }]),
  });
  const objectForm = parseMakeLeadBody({
    id: LEAD_ID,
    field_data: { email: "dana@example.com", phone_number: "+13125550101" },
  });
  assert.equal(stringified.ok && stringified.lead.metaLeadId, LEAD_ID);
  assert.equal(objectForm.ok && objectForm.lead.metaLeadId, LEAD_ID);
  if (!stringified.ok || !objectForm.ok) return;
  assert.equal(normalizeFieldData(stringified.lead.fieldData).email, "dana@example.com");
  assert.equal(normalizeFieldData(objectForm.lead.fieldData).phone_e164, "+13125550101");
});

test("make payloads without a lead id or without answers are rejected", () => {
  assert.deepEqual(parseMakeLeadBody({ field_data: [{ name: "email", values: ["a@b.co"] }] }), {
    ok: false,
    error: "lead id is required",
  });
  assert.deepEqual(parseMakeLeadBody({ id: LEAD_ID }), {
    ok: false,
    error: "field_data is required",
  });
  assert.equal(parseMakeLeadBody(null).ok, false);
});

test("replay of the same Meta lead id stays on one dedupe key across shapes", () => {
  const first = parseMakeLeadBody(ARRAY_BODY);
  const replay = parseMakeLeadBody({ ...FLAT_BODY, full_name: "Someone Else" });
  assert.equal(first.ok && replay.ok && first.lead.metaLeadId === replay.lead.metaLeadId, true);
});
