import test from "node:test";
import assert from "node:assert/strict";
import { googleAdsLeadQuery, mapAdsLeadSubmission, sinceDayUtc } from "./google-ads-leads.ts";

test("the Ads lead query is a fixed read of lead form submissions", () => {
  const query = googleAdsLeadQuery(sinceDayUtc(Date.parse("2026-09-26T00:00:00.000Z")));
  assert.match(query, /FROM lead_form_submission_data/);
  assert.match(query, /submission_date_time >= '2026-09-26 00:00:00'/);
  assert.doesNotMatch(query, /mutate/i);
});

test("a lead form row maps name, email, and phone and drops an empty row", () => {
  const mapped = mapAdsLeadSubmission({
    leadFormSubmissionData: {
      id: "customers/1/leadFormSubmissions/99",
      submissionDateTime: "2026-09-28 15:04:00",
      leadFormSubmissionFields: [
        { fieldType: "FULL_NAME", fieldValue: "Alex Example" },
        { fieldType: "EMAIL", fieldValue: "Alex@Example.com" },
        { fieldType: "PHONE_NUMBER", fieldValue: "3125550177" },
      ],
      customLeadFormSubmissionFields: [{ fieldType: "CUSTOM", fieldValue: "Brake noise" }],
    },
  });
  assert.ok(mapped);
  assert.equal(mapped.externalId, "google-ads:customers/1/leadFormSubmissions/99");
  assert.equal(mapped.name, "Alex Example");
  assert.equal(mapped.email, "alex@example.com");
  assert.equal(mapped.phoneRaw, "3125550177");
  assert.equal(mapped.symptoms, "Brake noise");
  assert.equal(mapAdsLeadSubmission({ leadFormSubmissionData: { id: "x" } }), null);
  assert.equal(mapAdsLeadSubmission({}), null);
});
