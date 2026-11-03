import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { authorizeMakeIntake } from "./make-auth.ts";
import { parseMakeLeadPayload } from "./make-payload.ts";
import { normalizeFieldData } from "./normalize.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) =>
  readFileSync(join(repoRoot, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const LEAD_ID = "2283654155812202";
const SECRET = "make-intake-test-secret";

function withSecret(value: string | undefined, run: () => void): void {
  const key = "MAKE_LEAD_INTAKE_SECRET";
  const prior = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    run();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://boltz.test/api/public/intake/make-lead", {
    method: "POST",
    headers,
  });
}

test("make intake returns 503 when the secret is unset and 401 before any match", () => {
  withSecret(undefined, () => {
    const denied = authorizeMakeIntake(request(`Bearer ${SECRET}`));
    assert.equal(denied?.status, 503);
  });
  withSecret("   ", () => {
    assert.equal(authorizeMakeIntake(request("Bearer x"))?.status, 503);
  });
  const auth = read("src/server/meta-leads/make-auth.ts");
  assert.match(auth, /secretEqual\(token, secret\)/);
  assert.doesNotMatch(auth, /token === secret|secret === token|safeEqual\(/);
  assert.ok(auth.indexOf("status: 503") < auth.indexOf("status: 401"));
  const route = read("src/routes/api/public/intake/make-lead.ts");
  const check = route.indexOf("authorizeMakeIntake(request)");
  const parse = route.indexOf("request.json()");
  assert.ok(check >= 0 && parse > check, "auth runs before the body is parsed");
});

test("make intake accepts only a matching bearer token", () => {
  withSecret(SECRET, () => {
    assert.equal(authorizeMakeIntake(request())?.status, 401);
    assert.equal(authorizeMakeIntake(request("Basic " + SECRET))?.status, 401);
    assert.equal(authorizeMakeIntake(request("Bearer"))?.status, 401);
    assert.equal(authorizeMakeIntake(request("Bearer "))?.status, 401);
    assert.equal(authorizeMakeIntake(request(`Bearer ${SECRET}x`))?.status, 401);
    assert.equal(authorizeMakeIntake(request("Bearer short"))?.status, 401);
    assert.equal(authorizeMakeIntake(request(`Bearer  ${SECRET}  `)), null);
    assert.equal(authorizeMakeIntake(request(`Bearer ${SECRET}`)), null);
  });
});

const arrayPayload = {
  id: LEAD_ID,
  created_time: "2026-11-03T18:04:00+0000",
  page_id: "111222333444555",
  form_id: "444555666777888",
  form_name: "Boltz estimate",
  ad_id: "999888777666555",
  ad_name: "Winter brakes",
  campaign: { id: "555444333222111", name: "Lead ads" },
  platform: "ig",
  field_data: [
    { name: "full_name", values: ["Jane Doe"] },
    { name: "email", values: "jane@example.com" },
    { name: "phone_number", values: ["3125550100"] },
    { name: "what_is_wrong_with_the_car", values: ["Brakes grind"] },
  ],
};

const flatPayload = {
  leadgen_id: LEAD_ID,
  created_time: "2026-11-03T18:04:00+0000",
  page_id: "111222333444555",
  form_id: "444555666777888",
  form_name: "Boltz estimate",
  ad_id: "999888777666555",
  ad_name: "Winter brakes",
  campaign_id: "555444333222111",
  campaign_name: "Lead ads",
  platform: "ig",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone_number: "3125550100",
  what_is_wrong_with_the_car: "Brakes grind",
};

test("field_data array and flattened key/value pairs normalize to the same lead", () => {
  const fromArray = parseMakeLeadPayload(arrayPayload);
  const fromFlat = parseMakeLeadPayload(flatPayload);
  assert.ok(!("error" in fromArray) && !("error" in fromFlat));
  if ("error" in fromArray || "error" in fromFlat) return;
  assert.equal(fromArray.metaLeadId, LEAD_ID);
  assert.equal(fromFlat.metaLeadId, fromArray.metaLeadId);
  assert.equal(fromArray.pageId, "111222333444555");
  assert.equal(fromFlat.pageId, fromArray.pageId);
  assert.equal(fromArray.formName, "Boltz estimate");
  assert.equal(fromFlat.formName, fromArray.formName);
  assert.equal(fromArray.lead.form_id, "444555666777888");
  assert.equal(fromArray.lead.ad_name, "Winter brakes");
  assert.equal(fromArray.lead.campaign_id, "555444333222111");
  assert.equal(fromFlat.lead.campaign_name, "Lead ads");
  assert.equal(fromArray.lead.platform, "ig");
  assert.equal(fromArray.lead.created_time, "2026-11-03T18:04:00.000Z");

  const arrayLead = normalizeFieldData(fromArray.lead.field_data);
  const flatLead = normalizeFieldData(fromFlat.lead.field_data);
  assert.equal(arrayLead.name, "Jane Doe");
  assert.equal(flatLead.name, arrayLead.name);
  assert.equal(arrayLead.email, "jane@example.com");
  assert.equal(flatLead.email, arrayLead.email);
  assert.equal(arrayLead.phone_e164, "+13125550100");
  assert.equal(flatLead.phone_e164, arrayLead.phone_e164);
  assert.match(arrayLead.symptoms ?? "", /Brakes grind/);
  assert.equal(flatLead.symptoms, arrayLead.symptoms);
  assert.equal(
    fromArray.lead.field_data?.some((field) => field.name === "page_id"),
    false,
  );
});

test("a field_data object and a wrapped Make bundle use the same lead id", () => {
  const asObject = parseMakeLeadPayload({
    id: LEAD_ID,
    field_data: {
      full_name: "Jane Doe",
      email: ["jane@example.com"],
      phone_number: "3125550100",
    },
  });
  const wrapped = parseMakeLeadPayload({
    lead: { lead_id: LEAD_ID, full_name: "Jane Doe", email: "jane@example.com" },
  });
  assert.ok(!("error" in asObject) && !("error" in wrapped));
  if ("error" in asObject || "error" in wrapped) return;
  assert.equal(asObject.metaLeadId, wrapped.metaLeadId);
  assert.equal(normalizeFieldData(asObject.lead.field_data).email, "jane@example.com");
  assert.equal(normalizeFieldData(wrapped.lead.field_data).name, "Jane Doe");
});

test("make intake dedupes on the Meta lead id and does not call Graph", () => {
  const again = parseMakeLeadPayload({
    ...flatPayload,
    id: LEAD_ID,
    leadgen_id: "999999999999999",
  });
  assert.ok(!("error" in again));
  if ("error" in again) return;
  // `id` wins over a second id field, and it is the key ingest stores.
  assert.equal(again.metaLeadId, LEAD_ID);

  const route = read("src/routes/api/public/intake/make-lead.ts");
  const ingest = read("src/server/meta-leads/ingest.server.ts");
  assert.match(route, /metaLeadId: parsed\.metaLeadId/);
  assert.match(route, /method: "MAKE"/);
  assert.match(route, /skipGraph: true/);
  assert.match(route, /duplicate: outcome\.status === "duplicate"/);
  assert.doesNotMatch(
    route,
    /getLead|getForm|pageAccessTokenFor|graph\.facebook|sendOutbound|sendSms|processJobs/,
  );
  assert.match(ingest, /onConflict: "meta_lead_id", ignoreDuplicates: true/);
  const guard = ingest.indexOf("if (!args.skipGraph && pageId)");
  const fetchLead = ingest.indexOf("await getLead(");
  const fetchForm = ingest.indexOf("await getForm(");
  assert.ok(guard >= 0 && guard < fetchLead && fetchLead < fetchForm);
  assert.match(ingest, /args\.skipGraph[\s\S]*providedForm/);
});

test("make intake rejects a missing or rounded lead id without echoing it", () => {
  assert.deepEqual(parseMakeLeadPayload({ full_name: "Jane Doe" }), {
    error: "lead id is required",
  });
  assert.deepEqual(parseMakeLeadPayload({ id: "not-a-lead" }), { error: "lead id is not valid" });
  assert.deepEqual(parseMakeLeadPayload([]), { error: "Invalid request body" });
  const unsafeId = "12345678901234567";
  const rounded = JSON.parse(`{"id":${unsafeId},"email":"jane@example.com"}`) as {
    id: number;
  };
  assert.equal(Number.isSafeInteger(rounded.id), false);
  const rejected = parseMakeLeadPayload(rounded);
  assert.deepEqual(rejected, { error: "lead id must be sent as a string" });
  assert.equal(JSON.stringify(rejected).includes(unsafeId), false);
});
