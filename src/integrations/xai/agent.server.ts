/**
 * Grok lead-SMS agent with deterministic pre/post safety enforcement.
 * Autonomous for ordinary replies — no draft/approval queue.
 */

import {
  BOLTZ_CONTEXT,
  GROK_PROMPT_VERSION,
  type EscalationCategory,
  type LeadLifecycle,
} from "@/lib/lead-inbox/constants";
import {
  detectHighRiskCategory,
  isOptInMessage,
  isOptOutMessage,
} from "@/lib/server/consent.server";
import { createStructuredGrokDecision } from "./client.server";
import type { GrokDecision } from "./schema";

export type LeadAgentContext = {
  lead: {
    id: string;
    name: string | null;
    phone_e164: string | null;
    email: string | null;
    vehicle_year: number | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_mileage: number | null;
    vin: string | null;
    symptoms: string | null;
    lifecycle: LeadLifecycle;
    consent_status: "unknown" | "opted_in" | "opted_out";
    notes: string | null;
  };
  thread: {
    id: string;
    control_mode: "auto" | "human";
  };
  inboundBody: string;
  recentMessages: Array<{ direction: "inbound" | "outbound"; body: string | null }>;
};

export type LeadAgentResult = {
  decision: GrokDecision;
  model: string;
  promptVersion: string;
  skippedModel: boolean;
  skipReason: string | null;
};

const SYSTEM_PROMPT = `You are the Boltz Automotive SMS lead agent for a private shop inbox.

Business facts (verified — do not invent beyond these):
- ${BOLTZ_CONTEXT.legalName}
- ${BOLTZ_CONTEXT.address}
- Main number: ${BOLTZ_CONTEXT.mainNumberDisplay}
- Hours: ${BOLTZ_CONTEXT.hours}
- ${BOLTZ_CONTEXT.lastAppointmentHint}
- Primary growth service: ${BOLTZ_CONTEXT.primaryGrowthService}
- Collision/body work is secondary

Rules:
- Keep SMS concise (ideally under 320 characters). Identify Boltz when context requires it.
- Never invent diagnoses, exact prices, availability, warranties, guarantees, or completion dates.
- Gather missing lead/vehicle information naturally.
- Do not claim an appointment is confirmed unless the system has confirmed it (it has not unless stated).
- action=send for ordinary helpful replies and opted-in follow-ups.
- action=escalate ONLY for threats, injuries, legal claims, insurance-liability disputes, payment/refund/chargeback disputes, harassment, unsupported discount requests, or explicit human request.
- action=no_reply when a reply would be harmful, redundant, or outside policy.
- Never choose recipients or credentials.
- Do not include chain-of-thought. audit_summary must be a short factual note only.
- Return ONLY structured JSON matching the schema.`;

function forcedDecision(
  partial: Omit<GrokDecision, "tags" | "audit_summary"> & {
    tags?: string[];
    audit_summary: string;
  },
): GrokDecision {
  return {
    action: partial.action,
    message: partial.message,
    lead_field_updates: partial.lead_field_updates,
    proposed_lifecycle: partial.proposed_lifecycle,
    tags: partial.tags ?? [],
    escalation_category: partial.escalation_category,
    audit_summary: partial.audit_summary,
  };
}

export async function runLeadSmsAgent(ctx: LeadAgentContext): Promise<LeadAgentResult> {
  // Deterministic opt-out — never send after STOP equivalents.
  if (isOptOutMessage(ctx.inboundBody)) {
    return {
      decision: forcedDecision({
        action: "no_reply",
        message: null,
        lead_field_updates: null,
        proposed_lifecycle: null,
        escalation_category: null,
        tags: ["opt_out"],
        audit_summary: "Customer opted out; automated messaging stopped.",
      }),
      model: "deterministic",
      promptVersion: GROK_PROMPT_VERSION,
      skippedModel: true,
      skipReason: "opt_out",
    };
  }

  if (ctx.lead.consent_status === "opted_out" && !isOptInMessage(ctx.inboundBody)) {
    return {
      decision: forcedDecision({
        action: "no_reply",
        message: null,
        lead_field_updates: null,
        proposed_lifecycle: null,
        escalation_category: null,
        tags: ["consent_blocked"],
        audit_summary: "Lead is opted out; no automated reply.",
      }),
      model: "deterministic",
      promptVersion: GROK_PROMPT_VERSION,
      skippedModel: true,
      skipReason: "consent_blocked",
    };
  }

  if (ctx.thread.control_mode === "human") {
    return {
      decision: forcedDecision({
        action: "no_reply",
        message: null,
        lead_field_updates: null,
        proposed_lifecycle: null,
        escalation_category: null,
        tags: ["human_control"],
        audit_summary: "Thread is in human-control mode; agent did not reply.",
      }),
      model: "deterministic",
      promptVersion: GROK_PROMPT_VERSION,
      skippedModel: true,
      skipReason: "human_control",
    };
  }

  const highRisk = detectHighRiskCategory(ctx.inboundBody);
  if (highRisk) {
    return {
      decision: forcedDecision({
        action: "escalate",
        message: null,
        lead_field_updates: null,
        proposed_lifecycle: null,
        escalation_category: highRisk,
        tags: ["deterministic_escalate", highRisk],
        audit_summary: `Escalated for ${highRisk}; switched to human control.`,
      }),
      model: "deterministic",
      promptVersion: GROK_PROMPT_VERSION,
      skippedModel: true,
      skipReason: "high_risk",
    };
  }

  if (isOptInMessage(ctx.inboundBody)) {
    // START / re-enable — short confirmation is allowed autonomously.
    return {
      decision: forcedDecision({
        action: "send",
        message:
          "You're opted back in to texts from Boltz Automotive. How can we help with your vehicle?",
        lead_field_updates: null,
        proposed_lifecycle: ctx.lead.lifecycle === "New" ? null : null,
        tags: ["opt_in"],
        escalation_category: null,
        audit_summary: "Customer re-opted in; sent confirmation.",
      }),
      model: "deterministic",
      promptVersion: GROK_PROMPT_VERSION,
      skippedModel: true,
      skipReason: "opt_in",
    };
  }

  const userPayload = {
    lead: ctx.lead,
    recent_messages: ctx.recentMessages.slice(-8),
    inbound_message: ctx.inboundBody,
  };

  const { decision, model } = await createStructuredGrokDecision({
    system: SYSTEM_PROMPT,
    user: JSON.stringify(userPayload),
  });

  return postProcessDecision(decision, model);
}

function postProcessDecision(decision: GrokDecision, model: string): LeadAgentResult {
  let next = decision;

  // Never invent confirmation of appointments.
  if (next.message && /appointment (is |has been )?confirm/i.test(next.message)) {
    next = {
      ...next,
      message:
        "Thanks for reaching out to Boltz Automotive. A team member will confirm appointment details with you shortly.",
      tags: [...next.tags, "appointment_claim_sanitized"],
      audit_summary: `${next.audit_summary} (sanitized appointment confirmation language)`,
    };
  }

  // Strip forbidden price/warranty guarantees if model slipped.
  if (
    next.message &&
    /(\$\s*\d+|warranty guaranteed|guaranteed (fix|done)|definitely ready by)/i.test(next.message)
  ) {
    next = {
      ...next,
      action: next.action === "send" ? "escalate" : next.action,
      message: next.action === "send" ? null : next.message,
      escalation_category: (next.escalation_category ?? "other_high_risk") as EscalationCategory,
      tags: [...next.tags, "policy_block_invented_claims"],
      audit_summary: `${next.audit_summary} (blocked invented price/warranty/date claims)`,
    };
  }

  if (next.action === "send" && (!next.message || !next.message.trim())) {
    next = {
      ...next,
      action: "no_reply",
      message: null,
      tags: [...next.tags, "empty_send_blocked"],
      audit_summary: `${next.audit_summary} (empty send blocked)`,
    };
  }

  return {
    decision: next,
    model,
    promptVersion: GROK_PROMPT_VERSION,
    skippedModel: false,
    skipReason: null,
  };
}
