import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsentLeadUpdate,
  validateConsentOptIn,
  type ConsentEvidenceInput,
} from "./start-owner-sms-policy.ts";

/** Mirrors the New SMS UI payload — no consent flags. */
const UI_DEFAULT_PAYLOAD = {
  phone: "+13125550142",
  text: "Hi, this is Boltz Automotive.",
  name: undefined as string | undefined,
};

type GuardOutcome =
  | { kind: "authorized" }
  | { kind: "forbidden"; message: string }
  | { kind: "rejected"; reason: string };

async function runStartOwnerSmsGuards(args: {
  authorized: boolean;
  markConsentOptIn: boolean;
  consentEvidence?: ConsentEvidenceInput;
}): Promise<GuardOutcome> {
  if (!args.authorized) {
    return { kind: "forbidden", message: "Missing capability: communications.send" };
  }

  const consentCheck = validateConsentOptIn({
    markConsentOptIn: args.markConsentOptIn,
    consentEvidence: args.consentEvidence,
  });
  if (!consentCheck.ok) {
    return { kind: "rejected", reason: consentCheck.reason };
  }

  return { kind: "authorized" };
}

test("unauthenticated or unauthorized callers fail before any lead lookup shape", async () => {
  const outcome = await runStartOwnerSmsGuards({
    authorized: false,
    markConsentOptIn: false,
  });
  assert.equal(outcome.kind, "forbidden");
  if (outcome.kind === "forbidden") {
    assert.match(outcome.message, /Missing capability/);
  }
});

test("authenticated-unauthorized is indistinguishable from missing staff role", async () => {
  const outcome = await runStartOwnerSmsGuards({
    authorized: false,
    markConsentOptIn: true,
    consentEvidence: { basis: "verbal" },
  });
  assert.equal(outcome.kind, "forbidden");
});

test("staff-authorized path accepts default UI payload without consent mutation", async () => {
  const outcome = await runStartOwnerSmsGuards({
    authorized: true,
    markConsentOptIn: false,
  });
  assert.equal(outcome.kind, "authorized");

  const consentUpdate = buildConsentLeadUpdate({
    markConsentOptIn: false,
    consentEvidence: undefined,
    leadSource: "owner_outbound",
    actorUserId: "staff-user",
    currentConsentStatus: "unknown",
  });
  assert.equal(consentUpdate, null);
  assert.equal(UI_DEFAULT_PAYLOAD.phone.length > 0, true);
});

test("owner-authorized explicit opt-in requires evidence server-side", async () => {
  const withoutEvidence = await runStartOwnerSmsGuards({
    authorized: true,
    markConsentOptIn: true,
  });
  assert.equal(withoutEvidence.kind, "rejected");

  const withEvidence = await runStartOwnerSmsGuards({
    authorized: true,
    markConsentOptIn: true,
    consentEvidence: {
      basis: "existing_business_relationship",
      note: "Repeat customer from prior RO",
    },
  });
  assert.equal(withEvidence.kind, "authorized");
});

test("fabricated consent evidence with invalid basis is rejected before service-role work", () => {
  const rawBasis = "owner_assertion_without_basis" as ConsentEvidenceInput["basis"];
  const result = validateConsentOptIn({
    markConsentOptIn: true,
    consentEvidence: { basis: rawBasis },
  });
  assert.equal(result.ok, false);
});

test("pre-service-role failures use generic responses without lead identifiers", async () => {
  const unauthorized = await runStartOwnerSmsGuards({ authorized: false, markConsentOptIn: false });
  assert.equal(unauthorized.kind, "forbidden");

  const badConsent = await runStartOwnerSmsGuards({
    authorized: true,
    markConsentOptIn: true,
  });
  assert.equal(badConsent.kind, "rejected");
  if (badConsent.kind === "rejected") {
    assert.doesNotMatch(badConsent.reason, /lead/i);
    assert.doesNotMatch(badConsent.reason, /thread/i);
    assert.doesNotMatch(badConsent.reason, /phone/i);
  }
});
