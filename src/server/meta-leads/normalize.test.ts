import test from "node:test";
import assert from "node:assert/strict";
import {
  META_LEAD_SOURCE,
  buildConsentEvidence,
  fillBlankLeadFields,
  formSummary,
  normalizeFieldData,
  normalizePhone,
  parseLeadgenEvents,
  resolvePlatform,
} from "./normalize.ts";

test("parseLeadgenEvents extracts batched leadgen changes and dedupes ids", () => {
  const events = parseLeadgenEvents({
    object: "page",
    entry: [
      {
        id: "PAGE1",
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: 111,
              form_id: "F1",
              ad_id: "A1",
              adgroup_id: "AS1",
              created_time: 1_700_000_000,
            },
          },
          { field: "feed", value: { post_id: "x" } },
          { field: "leadgen", value: { leadgen_id: "111" } },
        ],
      },
      {
        id: "PAGE2",
        changes: [{ field: "leadgen", value: { leadgen_id: "222", page_id: "PAGE2" } }],
      },
    ],
  });
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    leadgenId: "111",
    pageId: "PAGE1",
    formId: "F1",
    adId: "A1",
    adgroupId: "AS1",
    createdTime: new Date(1_700_000_000_000).toISOString(),
  });
  assert.equal(events[1]?.pageId, "PAGE2");
});

test("parseLeadgenEvents ignores non-page objects and malformed bodies", () => {
  assert.deepEqual(parseLeadgenEvents({ object: "user", entry: [] }), []);
  assert.deepEqual(parseLeadgenEvents(null), []);
  assert.deepEqual(
    parseLeadgenEvents({ object: "page", entry: [{ changes: [{ field: "leadgen", value: {} }] }] }),
    [],
  );
});

test("platform maps ig → instagram and everything else → facebook", () => {
  assert.equal(resolvePlatform("ig"), "instagram");
  assert.equal(resolvePlatform("fb"), "facebook");
  assert.equal(resolvePlatform(undefined), "facebook");
  assert.equal(META_LEAD_SOURCE.instagram, "Instagram Lead Ads");
  assert.equal(META_LEAD_SOURCE.facebook, "Facebook Lead Ads");
});

test("normalizePhone produces the E.164 shape leads.phone_e164 accepts, or null", () => {
  assert.equal(normalizePhone("+1 (312) 555-0100"), "+13125550100");
  assert.equal(normalizePhone("312-555-0100"), "+13125550100");
  assert.equal(normalizePhone("13125550100"), "+13125550100");
  assert.equal(normalizePhone("555"), null);
  assert.equal(normalizePhone(""), null);
});

test("standard Instant Form fields map exactly", () => {
  const n = normalizeFieldData([
    { name: "first_name", values: ["Dana"] },
    { name: "last_name", values: ["Lee"] },
    { name: "phone_number", values: ["+13125550101"] },
    { name: "work_phone_number", values: ["+13125550999"] },
    { name: "email", values: ["Dana@Example.COM"] },
    { name: "zip_code", values: ["60638"] },
  ]);
  assert.equal(n.name, "Dana Lee");
  assert.equal(n.phone_e164, "+13125550101", "first phone wins");
  assert.equal(n.email, "dana@example.com");
  assert.equal(n.zip_code, "60638");
  assert.deepEqual(n.other_answers, [{ question: "work_phone_number", answer: "+13125550999" }]);
});

test("custom vehicle questions map by keyword; unmatched answers are kept", () => {
  const n = normalizeFieldData([
    { name: "full_name", values: ["Riley"] },
    { name: "what_year,_make_and_model_is_your_vehicle?", values: ["2014 Honda Accord EX"] },
    { name: "approximate_mileage", values: ["142k"] },
    { name: "describe_the_problem", values: ["Knocking noise"] },
    { name: "is_it_drivable?", values: ["no"] },
    { name: "vin", values: ["1hgcr2f3xea000000"] },
  ]);
  assert.equal(n.vehicle_year, 2014);
  assert.equal(n.vehicle_make, "Honda");
  assert.equal(n.vehicle_model, "Accord EX");
  assert.equal(n.vehicle_mileage, 142_000);
  assert.equal(n.symptoms, "Knocking noise");
  assert.equal(n.vin, "1HGCR2F3XEA000000");
  assert.deepEqual(n.other_answers, [{ question: "is_it_drivable?", answer: "no" }]);
});

test("separate year / make / model questions and invalid values", () => {
  const n = normalizeFieldData([
    { name: "vehicle_year", values: ["2019"] },
    { name: "vehicle_make", values: ["Ford"] },
    { name: "vehicle_model", values: ["F-150"] },
    { name: "email", values: ["not-an-email"] },
  ]);
  assert.equal(n.vehicle_year, 2019);
  assert.equal(n.vehicle_make, "Ford");
  assert.equal(n.vehicle_model, "F-150");
  assert.equal(n.email, null);
  assert.equal(
    n.other_answers[0]?.answer,
    "not-an-email",
    "invalid email is preserved, not dropped",
  );
});

const form = {
  id: "F1",
  name: "Engine Quote",
  legal_content: {
    privacy_policy: { url: "https://example.com/privacy" },
    custom_disclaimer: {
      title: "Consent",
      body: { text: "We may contact you." },
      checkboxes: [
        { key: "sms_ok", checkbox_text: "Yes, text me about my estimate.", is_required: false },
        { key: "news", checkbox_text: "Send me the newsletter by email", is_required: false },
      ],
    },
  },
};

test("SMS opt-in requires the SMS checkbox to be checked", () => {
  const checked = buildConsentEvidence({
    lead: { id: "L1", custom_disclaimer_responses: [{ checkbox_key: "sms_ok", is_checked: "1" }] },
    form,
    platform: "facebook",
    nowIso: "2026-09-24T00:00:00.000Z",
  });
  assert.equal(checked.smsOptIn, true);
  assert.equal(checked.evidence.basis, "web_form");
  assert.equal(checked.evidence.privacy_policy_url, "https://example.com/privacy");
  assert.match(checked.consentText ?? "", /text me about my estimate/);

  const unchecked = buildConsentEvidence({
    lead: { id: "L2", custom_disclaimer_responses: [{ checkbox_key: "sms_ok", is_checked: "" }] },
    form,
    platform: "facebook",
    nowIso: "2026-09-24T00:00:00.000Z",
  });
  assert.equal(unchecked.smsOptIn, false);

  const nonSms = buildConsentEvidence({
    lead: { id: "L3", custom_disclaimer_responses: [{ checkbox_key: "news", is_checked: "1" }] },
    form,
    platform: "instagram",
    nowIso: "2026-09-24T00:00:00.000Z",
  });
  assert.equal(nonSms.smsOptIn, false, "an email/newsletter checkbox is not SMS consent");
  assert.equal(nonSms.evidence.source, "Instagram Lead Ads");
});

test("no disclaimer on the form means no opt-in and no consent text", () => {
  const result = buildConsentEvidence({
    lead: { id: "L4" },
    form: { id: "F2" },
    platform: "facebook",
    nowIso: "2026-09-24T00:00:00.000Z",
  });
  assert.equal(result.smsOptIn, false);
  assert.equal(result.consentText, null);
  assert.deepEqual(result.evidence.checkboxes, []);
});

test("fillBlankLeadFields never overwrites existing lead data", () => {
  const normalized = normalizeFieldData([
    { name: "full_name", values: ["Form Name"] },
    { name: "email", values: ["form@example.com"] },
    { name: "vehicle_make", values: ["Toyota"] },
  ]);
  const updates = fillBlankLeadFields(
    { name: "Staff Edited", email: null, vehicle_make: "" },
    normalized,
  );
  assert.deepEqual(updates, { email: "form@example.com", vehicle_make: "Toyota" });
});

test("formSummary is readable and bounded", () => {
  const summary = formSummary(
    normalizeFieldData([
      { name: "full_name", values: ["Dana"] },
      { name: "describe_the_problem", values: ["x".repeat(5000)] },
    ]),
    "Engine Quote",
  );
  assert.match(summary, /^Meta Instant Form "Engine Quote" submission:/);
  assert.ok(summary.length <= 2000);
});
