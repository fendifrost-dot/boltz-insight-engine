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
  return body
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
}

const RULES: { category: EscalationCategory; patterns: RegExp[] }[] = [
  {
    category: "threat",
    patterns: [/\bkill you\b/i, /\bshoot\b/i, /\bburn (down|your)\b/i, /\bthreat/i],
  },
  {
    category: "injury",
    patterns: [
      /\binjur/i,
      /\bhurt\b/i,
      /\bhospital\b/i,
      /\bambulance\b/i,
      /\bcrash(ed)? and\b.*\bhurt\b/i,
    ],
  },
  {
    category: "legal_claim",
    patterns: [
      /\blawyer\b/i,
      /\battorney\b/i,
      /\bsue\b|\bsuing\b|\blawsuit\b/i,
      /\bsmall claims\b/i,
      /\bsubpoena\b/i,
    ],
  },
  {
    category: "insurance_liability",
    patterns: [
      /\binsurance (claim|adjuster)\b/i,
      /\badjuster\b/i,
      /\bliab(le|ility)\b/i,
      /\btotal loss\b/i,
    ],
  },
  {
    category: "payment_dispute",
    patterns: [
      /\bchargeback\b/i,
      /\brefund\b/i,
      /\bdispute (the )?(charge|bill|invoice)\b/i,
      /\boverchar/i,
    ],
  },
  {
    category: "harassment",
    patterns: [/\bf+u+c+k+ you\b/i, /\bracist\b/i, /\bslur\b/i, /\bharass/i],
  },
  {
    category: "unsupported_discount",
    patterns: [
      /\bdiscount\b/i,
      /\bprice match\b/i,
      /\bfree (labor|diagnostic|tow)\b/i,
      /\bcash deal\b/i,
      /\bwarranty\b.*\bcover\b/i,
    ],
  },
  {
    category: "human_requested",
    patterns: [
      /\b(speak|talk) to (a )?(human|person|manager|owner|fendi)\b/i,
      /\bcall me\b/i,
      /\breal person\b/i,
    ],
  },
];

export function detectEscalation(
  body: string,
): { category: EscalationCategory; reason: string } | null {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(body)) {
        return {
          category: rule.category,
          reason: `Matched safety rule ${rule.category}: ${pattern}`,
        };
      }
    }
  }
  return null;
}

export const OPT_OUT_CONFIRMATION =
  "You're unsubscribed from Boltz Auto texts and won't get more messages from this number. Call (708) 575-4555 if you still need help.";

/** Outbound text validation: no invented promises, hard length ceiling. */
export const OUTBOUND_MAX_LENGTH = 480;

type OutboundRule = {
  pattern: RegExp;
  tag: string;
  /** Shown to whoever is sending, so a blocked text can be rephrased instead of retried as-is. */
  fix: string;
  /** A negation just before the match ("can't guarantee", "not a free diagnostic") is not a promise. */
  allowNegated?: boolean;
};

const FORBIDDEN_OUTBOUND: OutboundRule[] = [
  {
    pattern: /\b\d{1,2}\s*% ?off\b/i,
    tag: "discount_promise",
    fix: "remove the percent-off offer",
  },
  {
    pattern: /\bfree (labor|diagnostic|tow|engine)\b/i,
    tag: "free_service_promise",
    fix: "don't offer free labor, diagnostics or towing",
    allowNegated: true,
  },
  {
    pattern: /\bguarantee(d)?\b/i,
    tag: "guarantee_language",
    fix: 'drop the word "guarantee" (say an inspection is needed instead)',
    allowNegated: true,
  },
  {
    pattern: /\bwe('| a)re open (sunday|24)\b/i,
    tag: "hours_misstatement",
    fix: "remove the Sunday/24-hour claim",
  },
  {
    pattern: /\blifetime warranty\b/i,
    tag: "warranty_promise",
    fix: "remove the lifetime warranty claim",
  },
];

const NEGATION_BEFORE =
  /(\b(no|not|never|without|cannot|cant|wont|dont|isnt)\b|n't\b)[\w\s']{0,20}$/i;

function isNegated(text: string, index: number): boolean {
  // Normalize curly apostrophes so "can’t guarantee" reads as a negation.
  return NEGATION_BEFORE.test(text.slice(Math.max(0, index - 40), index).replace(/\u2019/g, "'"));
}

export type OutboundCheck = {
  ok: boolean;
  tags: string[];
  /** One entry per failed rule: the offending phrase and how to fix it. */
  problems: string[];
};

export function validateOutbound(text: string): OutboundCheck {
  const tags: string[] = [];
  const problems: string[] = [];
  if (text.trim().length === 0) {
    tags.push("empty");
    problems.push("message is empty");
  }
  if (text.length > OUTBOUND_MAX_LENGTH) {
    tags.push("too_long");
    problems.push(`message is ${text.length} characters; the limit is ${OUTBOUND_MAX_LENGTH}`);
  }
  for (const rule of FORBIDDEN_OUTBOUND) {
    const global = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`,
    );
    for (const match of text.matchAll(global)) {
      if (rule.allowNegated && isNegated(text, match.index ?? 0)) continue;
      tags.push(rule.tag);
      problems.push(`"${match[0]}" (${rule.tag}): ${rule.fix}`);
      break;
    }
  }
  return { ok: tags.length === 0, tags, problems };
}

/** Human-readable block reason: says which rule fired, so the same text is not simply retried. */
export function describeOutboundBlock(check: OutboundCheck): string {
  return `Blocked by outbound policy validation — ${check.problems.join("; ")}`;
}
