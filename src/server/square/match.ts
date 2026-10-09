import { emailKey, phoneE164 } from "./normalize.ts";

export type MatchStatus = "exact_phone" | "exact_email" | "ambiguous" | "unmatched";

export type LeadCandidate = {
  id: string;
  phone_e164: string | null;
  email: string | null;
};

export type MatchResult = {
  leadId: string | null;
  matchStatus: MatchStatus;
};

export function matchLead(args: {
  phone: string | null;
  email: string | null;
  candidates: LeadCandidate[];
}): MatchResult {
  const phone = phoneE164(args.phone);
  const phoneDigits = phone ? phoneKeySafe(phone) : null;
  const email = emailKey(args.email);

  const byPhone = new Set<string>();
  const byEmail = new Set<string>();
  for (const candidate of args.candidates) {
    if (phoneDigits && phoneKeySafe(candidate.phone_e164) === phoneDigits)
      byPhone.add(candidate.id);
    if (email && emailKey(candidate.email) === email) byEmail.add(candidate.id);
  }

  const phones = [...byPhone];
  const emails = [...byEmail];
  if (phones.length === 1 && emails.length === 1 && phones[0] !== emails[0]) {
    return { leadId: null, matchStatus: "ambiguous" };
  }
  if (phones.length === 1) return { leadId: phones[0]!, matchStatus: "exact_phone" };
  if (phones.length > 1) return { leadId: null, matchStatus: "ambiguous" };
  if (emails.length === 1) return { leadId: emails[0]!, matchStatus: "exact_email" };
  if (emails.length > 1) return { leadId: null, matchStatus: "ambiguous" };
  return { leadId: null, matchStatus: "unmatched" };
}

function phoneKeySafe(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

/**
 * A later payload that omits phone and email must not drop an exact link.
 * An ambiguous result clears the link so two leads are never collapsed into one.
 */
export function nextMatch(
  previous: { leadId: string | null; matchStatus: string } | null,
  computed: MatchResult,
): MatchResult {
  if (computed.matchStatus === "exact_phone" || computed.matchStatus === "exact_email") {
    return computed;
  }
  if (computed.matchStatus === "ambiguous") return computed;
  if (
    previous?.leadId &&
    (previous.matchStatus === "exact_phone" || previous.matchStatus === "exact_email")
  ) {
    return {
      leadId: previous.leadId,
      matchStatus: previous.matchStatus,
    };
  }
  return computed;
}
