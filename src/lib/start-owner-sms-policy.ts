export const CONSENT_BASIS = [
  "customer_message",
  "web_form",
  "written",
  "verbal",
  "existing_business_relationship",
  "provider_event",
  "manual_correction",
] as const;

export type ConsentBasis = (typeof CONSENT_BASIS)[number];

export type ConsentEvidenceInput = {
  basis: ConsentBasis;
  note?: string;
  evidenceRef?: string;
};

export type ConsentValidationInput = {
  markConsentOptIn: boolean;
  consentEvidence?: ConsentEvidenceInput;
};

export function validateConsentOptIn(
  input: ConsentValidationInput,
): { ok: true } | { ok: false; reason: string } {
  if (!input.markConsentOptIn) {
    return { ok: true };
  }
  if (!input.consentEvidence?.basis) {
    return {
      ok: false,
      reason: "Consent opt-in requires a basis and evidence object",
    };
  }
  if (!CONSENT_BASIS.includes(input.consentEvidence.basis)) {
    return { ok: false, reason: "Invalid consent basis" };
  }
  return { ok: true };
}

export function buildConsentLeadUpdate(args: {
  markConsentOptIn: boolean;
  consentEvidence: ConsentEvidenceInput | undefined;
  leadSource: string;
  actorUserId: string;
  currentConsentStatus: "unknown" | "opted_in" | "opted_out";
  nowIso?: string;
}): Record<string, unknown> | null {
  if (!args.markConsentOptIn || args.currentConsentStatus === "opted_in") {
    return null;
  }
  if (!args.consentEvidence?.basis) {
    return null;
  }

  const at = args.nowIso ?? new Date().toISOString();
  return {
    consent_status: "opted_in",
    consent_updated_at: at,
    consent_evidence: {
      source: args.leadSource,
      basis: args.consentEvidence.basis,
      evidence_ref: args.consentEvidence.evidenceRef ?? null,
      note: args.consentEvidence.note ?? null,
      asserted_by: args.actorUserId,
      at,
    },
  };
}
