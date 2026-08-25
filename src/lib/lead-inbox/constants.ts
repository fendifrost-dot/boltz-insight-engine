/**
 * Shared lead-inbox domain constants (safe for client + server).
 * Unknown values are null — never empty string or measured-zero placeholders.
 */

export const LEAD_LIFECYCLES = [
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
  "Lost",
  "No response",
  "No-show",
  "Duplicate",
  "Spam",
  "Outside service capability",
] as const;

export type LeadLifecycle = (typeof LEAD_LIFECYCLES)[number];

export const CONSENT_STATUSES = ["unknown", "opted_in", "opted_out"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const THREAD_CONTROL_MODES = ["auto", "human"] as const;
export type ThreadControlMode = (typeof THREAD_CONTROL_MODES)[number];

export const AGENT_ACTIONS = ["send", "escalate", "no_reply"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const ESCALATION_CATEGORIES = [
  "threat",
  "injury",
  "legal_claim",
  "insurance_liability",
  "payment_dispute",
  "harassment",
  "unsupported_discount",
  "human_requested",
  "other_high_risk",
] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];

export const OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
] as const;

export const OPT_IN_KEYWORDS = ["START", "UNSTOP", "YES"] as const;

export const BOLTZ_CONTEXT = {
  legalName: "Boltz Automotive Inc.",
  address: "707 W. 119th St., Chicago, IL 60628",
  mainNumberDisplay: "+1 708-575-4555",
  mainNumberE164: "+17085754555",
  hours: "Monday–Saturday, 9 AM–5 PM",
  lastAppointmentHint: "Last appointment is generally around 4 PM",
  primaryGrowthService: "engine replacement",
  secondaryService: "collision/body work",
} as const;

export const GROK_PROMPT_VERSION = "boltz-lead-sms-v1";

export function isLeadLifecycle(value: string): value is LeadLifecycle {
  return (LEAD_LIFECYCLES as readonly string[]).includes(value);
}
