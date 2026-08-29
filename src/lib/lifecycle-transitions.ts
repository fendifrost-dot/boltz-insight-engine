import { Constants, type Database } from "../integrations/supabase/types.ts";

export type Lifecycle = Database["public"]["Enums"]["lead_lifecycle"];

export const LIFECYCLE_VALUES = Constants.public.Enums.lead_lifecycle;

/** Primary repair funnel — forward order only for automated intake. */
export const LIFECYCLE_FUNNEL: readonly Lifecycle[] = [
  "New",
  "Contacted",
  "Qualified",
  "Appointment Scheduled",
  "Inspected",
  "Estimate Sent",
  "Approved",
  "In Progress",
  "Completed",
  "Paid",
];

/** Terminal or disqualifying states — not executable by Grok. */
export const LIFECYCLE_TERMINAL: readonly Lifecycle[] = [
  "Lost",
  "No response",
  "No-show",
  "Duplicate",
  "Spam",
  "Outside service capability",
];

/** Terminal states Grok may recommend but must not execute. */
export const GROK_RECOMMENDED_TERMINAL: readonly Lifecycle[] = [
  "Lost",
  "No response",
  "Spam",
  "Outside service capability",
];

/** Intake stages where Grok may advance lifecycle one step. */
export const AGENT_INTAKE_STAGES: readonly Lifecycle[] = ["New", "Contacted", "Qualified"];

export const LIFECYCLE_EVIDENCE_BASIS = [
  "agent_decision",
  "customer_message",
  "staff_observation",
  "appointment_record",
  "inspection_record",
  "estimate_record",
  "payment_record",
  "manual_correction",
  "system_rule",
] as const;

export type LifecycleEvidenceBasis = (typeof LIFECYCLE_EVIDENCE_BASIS)[number];

export type LifecycleEvidence = {
  basis: LifecycleEvidenceBasis;
  evidenceRef?: string | undefined;
  note?: string | undefined;
  agentRunId?: string | undefined;
  inboundMessageId?: string | undefined;
  assertedBy?: string | undefined;
  at?: string | undefined;
};

export type TransitionActorKind = "grok" | "staff" | "owner" | "system";

const STAFF_EVIDENCE_BASIS: readonly LifecycleEvidenceBasis[] = [
  "customer_message",
  "staff_observation",
  "appointment_record",
  "inspection_record",
  "estimate_record",
  "manual_correction",
];

const OWNER_EVIDENCE_BASIS: readonly LifecycleEvidenceBasis[] = [
  ...STAFF_EVIDENCE_BASIS,
  "payment_record",
];

const SYSTEM_EVIDENCE_BASIS: readonly LifecycleEvidenceBasis[] = ["system_rule"];

function funnelIndex(state: Lifecycle): number {
  return LIFECYCLE_FUNNEL.indexOf(state);
}

function isFunnelState(state: Lifecycle): boolean {
  return funnelIndex(state) >= 0;
}

function isTerminalState(state: Lifecycle): boolean {
  return (LIFECYCLE_TERMINAL as readonly string[]).includes(state);
}

function touchesPaid(state: Lifecycle): boolean {
  return state === "Paid";
}

function adjacentForward(from: Lifecycle): Lifecycle | null {
  const index = funnelIndex(from);
  if (index < 0 || index >= LIFECYCLE_FUNNEL.length - 1) return null;
  return LIFECYCLE_FUNNEL[index + 1] ?? null;
}

function adjacentBackward(from: Lifecycle): Lifecycle | null {
  const index = funnelIndex(from);
  if (index <= 0) return null;
  return LIFECYCLE_FUNNEL[index - 1] ?? null;
}

export function requiresFinancialConfirm(from: Lifecycle, to: Lifecycle): boolean {
  return touchesPaid(from) || touchesPaid(to);
}

export function isAllowedLifecycleTransition(args: {
  from: Lifecycle;
  to: Lifecycle;
  actor: TransitionActorKind;
}): boolean {
  const { from, to, actor } = args;
  if (from === to) return true;

  if (actor === "grok") {
    if (!(AGENT_INTAKE_STAGES as readonly string[]).includes(from)) return false;
    const next = adjacentForward(from);
    if (next !== to) return false;
    return (AGENT_INTAKE_STAGES as readonly string[]).includes(to);
  }

  if (actor === "staff") {
    if (touchesPaid(from) || touchesPaid(to)) return false;
    if (isFunnelState(from) && isFunnelState(to)) {
      return adjacentForward(from) === to || adjacentBackward(from) === to;
    }
    if (isFunnelState(from) && isTerminalState(to)) return true;
    if (isTerminalState(from) && to === "Contacted") return true;
    return false;
  }

  if (actor === "owner") {
    if (from === "Completed" && to === "Paid") {
      return adjacentForward(from) === to;
    }
    if (from === "Paid" && to === "Completed") {
      return adjacentBackward(from) === to;
    }
    if (touchesPaid(from) || touchesPaid(to)) return false;
    if (isFunnelState(from) && isFunnelState(to)) {
      return adjacentForward(from) === to || adjacentBackward(from) === to;
    }
    if (isFunnelState(from) && isTerminalState(to)) return true;
    if (isTerminalState(from) && to === "Contacted") return true;
    return false;
  }

  if (actor === "system") {
    if (from === "New" && to === "New") return true;
    return false;
  }

  return false;
}

function hasEvidenceRef(evidence: LifecycleEvidence): boolean {
  return Boolean(evidence.evidenceRef?.trim());
}

function validateDestinationEvidence(args: {
  from: Lifecycle;
  to: Lifecycle;
  actor: TransitionActorKind;
  evidence: LifecycleEvidence;
}): { ok: true } | { ok: false; reason: string } {
  const { from, to, actor, evidence } = args;

  if (to === "Appointment Scheduled") {
    if (evidence.basis !== "appointment_record") {
      return { ok: false, reason: "Appointment Scheduled requires appointment_record evidence" };
    }
    if (!hasEvidenceRef(evidence)) {
      return { ok: false, reason: "Appointment Scheduled requires evidence_ref" };
    }
  }

  if (to === "Inspected") {
    if (evidence.basis !== "inspection_record") {
      return { ok: false, reason: "Inspected requires inspection_record evidence" };
    }
    if (!hasEvidenceRef(evidence)) {
      return { ok: false, reason: "Inspected requires evidence_ref" };
    }
  }

  if (to === "Estimate Sent") {
    if (evidence.basis !== "estimate_record") {
      return { ok: false, reason: "Estimate Sent requires estimate_record evidence" };
    }
    if (!hasEvidenceRef(evidence)) {
      return { ok: false, reason: "Estimate Sent requires evidence_ref" };
    }
  }

  if (to === "Approved") {
    if (evidence.basis !== "customer_message" && evidence.basis !== "estimate_record") {
      return {
        ok: false,
        reason: "Approved requires customer_message or estimate_record evidence",
      };
    }
    if (!hasEvidenceRef(evidence)) {
      return { ok: false, reason: "Approved requires evidence_ref" };
    }
  }

  if (to === "Paid") {
    if (actor !== "owner") {
      return { ok: false, reason: "Only owners may mark a lead Paid" };
    }
    if (from !== "Completed") {
      return { ok: false, reason: "Paid requires a Completed lead" };
    }
    if (evidence.basis !== "payment_record") {
      return { ok: false, reason: "Paid requires payment_record evidence" };
    }
    if (!hasEvidenceRef(evidence)) {
      return { ok: false, reason: "Paid requires evidence_ref" };
    }
  }

  if (from === "Paid") {
    if (actor !== "owner") {
      return { ok: false, reason: "Only owners may reverse a Paid lifecycle" };
    }
    if (to !== "Completed") {
      return { ok: false, reason: "Paid may only revert to Completed with documented correction" };
    }
    if (evidence.basis !== "manual_correction") {
      return { ok: false, reason: "Paid reversal requires manual_correction evidence" };
    }
    if (!hasEvidenceRef(evidence)) {
      return { ok: false, reason: "Paid reversal requires evidence_ref" };
    }
  }

  return { ok: true };
}

export function validateLifecycleEvidence(args: {
  actor: TransitionActorKind;
  evidence: LifecycleEvidence | undefined;
}): { ok: true } | { ok: false; reason: string } {
  const evidence = args.evidence;
  if (!evidence?.basis) {
    return { ok: false, reason: "Lifecycle transition requires evidence with a basis" };
  }
  if (!LIFECYCLE_EVIDENCE_BASIS.includes(evidence.basis)) {
    return { ok: false, reason: "Invalid lifecycle evidence basis" };
  }

  if (args.actor === "grok") {
    if (evidence.basis !== "agent_decision") {
      return { ok: false, reason: "Agent lifecycle transitions require agent_decision evidence" };
    }
    if (!evidence.agentRunId) {
      return { ok: false, reason: "Agent lifecycle transitions require agent_run_id evidence" };
    }
    if (!evidence.inboundMessageId) {
      return { ok: false, reason: "Agent lifecycle transitions require inbound_message_id evidence" };
    }
    return { ok: true };
  }

  if (args.actor === "staff") {
    if (!STAFF_EVIDENCE_BASIS.includes(evidence.basis)) {
      return { ok: false, reason: "Staff lifecycle transitions require operational evidence basis" };
    }
    if (evidence.basis === "payment_record") {
      return { ok: false, reason: "Staff may not use payment_record evidence" };
    }
    if (!evidence.assertedBy) {
      return { ok: false, reason: "Staff lifecycle transitions require asserted_by user id" };
    }
    return { ok: true };
  }

  if (args.actor === "owner") {
    if (!OWNER_EVIDENCE_BASIS.includes(evidence.basis)) {
      return { ok: false, reason: "Owner lifecycle transitions require operational evidence basis" };
    }
    if (!evidence.assertedBy) {
      return { ok: false, reason: "Owner lifecycle transitions require asserted_by user id" };
    }
    return { ok: true };
  }

  if (args.actor === "system") {
    if (!SYSTEM_EVIDENCE_BASIS.includes(evidence.basis)) {
      return { ok: false, reason: "System lifecycle transitions require system_rule evidence" };
    }
    if (!evidence.evidenceRef) {
      return { ok: false, reason: "System lifecycle transitions require evidence_ref" };
    }
    return { ok: true };
  }

  return { ok: false, reason: "Unsupported lifecycle transition actor" };
}

export function validateLifecycleTransition(args: {
  from: Lifecycle;
  to: Lifecycle;
  actor: TransitionActorKind;
  evidence: LifecycleEvidence | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (args.from === args.to) {
    return { ok: true };
  }

  const evidenceResult = validateLifecycleEvidence({ actor: args.actor, evidence: args.evidence });
  if (!evidenceResult.ok) return evidenceResult;

  if (!isAllowedLifecycleTransition(args)) {
    return {
      ok: false,
      reason: `Transition ${args.from} → ${args.to} is not allowed for actor ${args.actor}`,
    };
  }

  if (!args.evidence) {
    return { ok: false, reason: "Lifecycle transition requires evidence" };
  }

  const destinationResult = validateDestinationEvidence({
    from: args.from,
    to: args.to,
    actor: args.actor,
    evidence: args.evidence,
  });
  if (!destinationResult.ok) return destinationResult;

  return { ok: true };
}

export function buildLifecycleEvidenceMetadata(
  evidence: LifecycleEvidence,
  nowIso?: string,
): Record<string, unknown> {
  return {
    basis: evidence.basis,
    evidence_ref: evidence.evidenceRef ?? null,
    note: evidence.note ?? null,
    agent_run_id: evidence.agentRunId ?? null,
    inbound_message_id: evidence.inboundMessageId ?? null,
    asserted_by: evidence.assertedBy ?? null,
    at: evidence.at ?? nowIso ?? new Date().toISOString(),
  };
}

/** Map persisted lead_events.actor strings to policy actor kinds. */
export function resolveTransitionActorKind(actor: string): TransitionActorKind | null {
  if (actor === "grok" || actor === "system") return actor;
  if (actor.startsWith("owner:")) return "owner";
  if (actor.startsWith("staff:")) return "staff";
  return null;
}
