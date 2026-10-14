// Phone values stored on leads and message threads.
// Must satisfy public.leads.leads_phone_e164_format: ^\+[1-9][0-9]{7,14}$

/** E.164 shape required by leads.phone_e164 and message_threads.phone_e164. */
export const LEAD_PHONE_E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * Shown on the job when an inbound SMS cannot become a lead.
 * The worker records this on attempt 1 and does not retry.
 */
export const INBOUND_PHONE_NEEDS_REVIEW =
  "skipped: inbound phone cannot be normalized to E.164 (leads_phone_e164_format); needs_review. No lead was created.";

/**
 * US shop default: 10 national digits become +1. An 11-digit number that
 * already starts with 1, or any other 8–15 digit number that satisfies the
 * leads check, is kept. Empty, null, and garbage return null — never "+".
 */
export function normalizeLeadPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else e164 = `+${digits}`;

  return LEAD_PHONE_E164.test(e164) ? e164 : null;
}

export type InboundPhoneDecision =
  | { action: "accept"; phone: string }
  | {
      action: "skip";
      permanent: true;
      disposition: "needs_review";
      skipped: true;
      lastError: string;
    };

/** Accept a storable E.164, or skip the inbound without creating a lead. */
export function decideInboundPhone(raw: unknown): InboundPhoneDecision {
  const phone = typeof raw === "string" ? normalizeLeadPhone(raw) : null;
  if (!phone) {
    return {
      action: "skip",
      permanent: true,
      disposition: "needs_review",
      skipped: true,
      lastError: INBOUND_PHONE_NEEDS_REVIEW,
    };
  }
  return { action: "accept", phone };
}

/**
 * Flag the inbound job payload for a person. The original from/body stay put;
 * messages cannot be inserted without a lead, so the job is the review record.
 */
export function stampInboundNeedsReview(payload: unknown): Record<string, unknown> {
  const base: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : {};
  return {
    ...base,
    disposition: "needs_review",
    skipped: true,
    skip_reason: "unnormalizable_phone",
  };
}
