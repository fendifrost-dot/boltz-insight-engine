import test from "node:test";
import assert from "node:assert/strict";
import { buildConsentLeadUpdate, validateConsentOptIn } from "./start-owner-sms-policy.ts";

test("default path does not require consent evidence", () => {
  const result = validateConsentOptIn({ markConsentOptIn: false });
  assert.equal(result.ok, true);
});

test("opt-in without evidence is rejected", () => {
  const result = validateConsentOptIn({ markConsentOptIn: true });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /basis and evidence/i);
  }
});

test("opt-in with basis and evidence is accepted", () => {
  const result = validateConsentOptIn({
    markConsentOptIn: true,
    consentEvidence: {
      basis: "existing_business_relationship",
      note: "Prior repair customer from 2024 invoice",
      evidenceRef: "invoice-2024-1182",
    },
  });
  assert.equal(result.ok, true);
});

test("buildConsentLeadUpdate returns null when opt-in is false", () => {
  const update = buildConsentLeadUpdate({
    markConsentOptIn: false,
    consentEvidence: undefined,
    leadSource: "owner_outbound",
    actorUserId: "user-1",
    currentConsentStatus: "unknown",
    nowIso: "2026-08-27T22:00:00.000Z",
  });
  assert.equal(update, null);
});

test("buildConsentLeadUpdate records basis, actor, and timestamp", () => {
  const update = buildConsentLeadUpdate({
    markConsentOptIn: true,
    consentEvidence: {
      basis: "verbal",
      note: "Customer agreed on phone",
      evidenceRef: "call-log-42",
    },
    leadSource: "owner_outbound",
    actorUserId: "user-owner",
    currentConsentStatus: "unknown",
    nowIso: "2026-08-27T22:00:00.000Z",
  });
  assert.ok(update);
  assert.equal(update?.["consent_status"], "opted_in");
  assert.equal(update?.["consent_updated_at"], "2026-08-27T22:00:00.000Z");
  const evidence = update?.["consent_evidence"] as Record<string, unknown>;
  assert.equal(evidence.basis, "verbal");
  assert.equal(evidence.asserted_by, "user-owner");
  assert.equal(evidence.evidence_ref, "call-log-42");
  assert.equal(evidence.source, "owner_outbound");
});

test("buildConsentLeadUpdate skips when lead is already opted in", () => {
  const update = buildConsentLeadUpdate({
    markConsentOptIn: true,
    consentEvidence: { basis: "written" },
    leadSource: "owner_outbound",
    actorUserId: "user-owner",
    currentConsentStatus: "opted_in",
  });
  assert.equal(update, null);
});
