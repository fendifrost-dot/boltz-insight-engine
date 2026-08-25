/**
 * Deterministic SMS consent / opt-out helpers.
 * These rules run in application code before and after any model call.
 */

import { OPT_IN_KEYWORDS, OPT_OUT_KEYWORDS } from "@/lib/lead-inbox/constants";

export function normalizeSmsKeyword(body: string | null | undefined): string {
  if (!body) return "";
  return body.trim().toUpperCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

export function isOptOutMessage(body: string | null | undefined): boolean {
  const normalized = normalizeSmsKeyword(body);
  if (!normalized) return false;
  const first = normalized.split(" ")[0] ?? normalized;
  return (OPT_OUT_KEYWORDS as readonly string[]).includes(first) || (OPT_OUT_KEYWORDS as readonly string[]).includes(normalized);
}

export function isOptInMessage(body: string | null | undefined): boolean {
  const normalized = normalizeSmsKeyword(body);
  if (!normalized) return false;
  const first = normalized.split(" ")[0] ?? normalized;
  return (OPT_IN_KEYWORDS as readonly string[]).includes(first);
}

/**
 * High-risk content that must escalate to human control without autonomous reply.
 * Conservative keyword/heuristic gate — model may also escalate.
 */
export function detectHighRiskCategory(
  body: string | null | undefined,
):
  | "threat"
  | "injury"
  | "legal_claim"
  | "insurance_liability"
  | "payment_dispute"
  | "harassment"
  | "unsupported_discount"
  | "human_requested"
  | null {
  if (!body) return null;
  const text = body.toLowerCase();

  if (/\b(kill|murder|bomb|shoot|violence|threaten|i'?ll sue your family)\b/.test(text)) {
    return "threat";
  }
  if (/\b(injured|injury|hurt|bleeding|hospital|ambulance|broken bone)\b/.test(text)) {
    return "injury";
  }
  if (/\b(lawsuit|attorney|lawyer|sue you|legal action|court summons)\b/.test(text)) {
    return "legal_claim";
  }
  if (/\b(insurance claim|liability|at fault|totaled by you)\b/.test(text)) {
    return "insurance_liability";
  }
  if (/\b(refund|chargeback|dispute the charge|stolen money|scam)\b/.test(text)) {
    return "payment_dispute";
  }
  if (/\b(harass|stalk|idiot|fuck you|go to hell)\b/.test(text)) {
    return "harassment";
  }
  if (/\b(free job|do it for free|half price guarantee|unlimited discount)\b/.test(text)) {
    return "unsupported_discount";
  }
  if (
    /\b(speak to (a |the )?(human|person|manager|owner)|real person|call me back|talk to someone)\b/.test(
      text,
    )
  ) {
    return "human_requested";
  }
  return null;
}
