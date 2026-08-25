// Deterministic guardrails applied before any model call.
import type { Database } from "@/integrations/supabase/types";

type EscalationCategory = Database["public"]["Enums"]["escalation_category"];

const OPT_OUT = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];
const OPT_IN = ["start", "unstop", "yes please text me"];

export function detectOptOut(body: string): boolean {
  const t = normalize(body);
  return OPT_OUT.includes(t);
}

export function detectOptIn(body: string): boolean {
  const t = normalize(body);
  return OPT_IN.includes(t);
}

export function normalize(body: string): string {
  return body.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
}

const RULES: { category: EscalationCategory; patterns: RegExp[] }[] = [
  { category: "threat", patterns: [/\bkill you\b/i, /\bshoot\b/i, /\bburn (down|your)\b/i, /\bthreat/i] },
  { category: "injury", patterns: [/\binjur/i, /\bhurt\b/i, /\bhospital\b/i, /\bambulance\b/i, /\bcrash(ed)? and\b.*\bhurt\b/i] },
  { category: "legal_claim", patterns: [/\blawyer\b/i, /\battorney\b/i, /\bsue\b|\bsuing\b|\blawsuit\b/i, /\bsmall claims\b/i, /\bsubpoena\b/i] },
  { category: "insurance_liability", patterns: [/\binsurance (claim|adjuster)\b/i, /\badjuster\b/i, /\bliab(le|ility)\b/i, /\btotal loss\b/i] },
  { category: "payment_dispute", patterns: [/\bchargeback\b/i, /\brefund\b/i, /\bdispute (the )?(charge|bill|invoice)\b/i, /\boverchar/i] },
  { category: "harassment", patterns: [/\bf+u+c+k+ you\b/i, /\bracist\b/i, /\bslur\b/i, /\bharass/i] },
  { category: "unsupported_discount", patterns: [/\bdiscount\b/i, /\bprice match\b/i, /\bfree (labor|diagnostic|tow)\b/i, /\bcash deal\b/i, /\bwarranty\b.*\bcover\b/i] },
  { category: "human_requested", patterns: [/\b(speak|talk) to (a )?(human|person|manager|owner|fendi)\b/i, /\bcall me\b/i, /\breal person\b/i] },
];

export function detectEscalation(body: string): { category: EscalationCategory; reason: string } | null {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(body)) {
        return { category: rule.category, reason: `Matched safety rule ${rule.category}: ${pattern}` };
      }
    }
  }
  return null;
}

export const OPT_OUT_CONFIRMATION =
  "You're unsubscribed from Boltz Auto texts and won't get more messages from this number. Call (708) 575-4555 if you still need help.";

/** Outbound text validation: no invented promises, hard length ceiling. */
const FORBIDDEN_OUTBOUND: { pattern: RegExp; tag: string }[] = [
  { pattern: /\b\d{1,2}\s*% ?off\b/i, tag: "discount_promise" },
  { pattern: /\bfree (labor|diagnostic|tow|engine)\b/i, tag: "free_service_promise" },
  { pattern: /\bguarantee(d)?\b/i, tag: "guarantee_language" },
  { pattern: /\bwe('| a)re open (sunday|24)\b/i, tag: "hours_misstatement" },
  { pattern: /\blifetime warranty\b/i, tag: "warranty_promise" },
];

export function validateOutbound(text: string): { ok: boolean; tags: string[] } {
  const tags: string[] = [];
  if (text.trim().length === 0) tags.push("empty");
  if (text.length > 480) tags.push("too_long");
  for (const rule of FORBIDDEN_OUTBOUND) if (rule.pattern.test(text)) tags.push(rule.tag);
  return { ok: tags.length === 0, tags };
}
