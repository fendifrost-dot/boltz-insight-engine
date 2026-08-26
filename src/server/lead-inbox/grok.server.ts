// xAI (Grok) agent adapter. Server-only.
import { z } from "zod";
import { Constants } from "@/integrations/supabase/types";
import { readSecret, requireSecret } from "./env.server";
import { BUSINESS } from "@/data/context";
import type { Database } from "@/integrations/supabase/types";
import type { LeadRow, MessageRow } from "./store.server";

export const PROMPT_VERSION = "boltz-sms-agent-v1";

type Lifecycle = Database["public"]["Enums"]["lead_lifecycle"];
type EscalationCategory = Database["public"]["Enums"]["escalation_category"];

export type AgentDecision = {
  action: Database["public"]["Enums"]["agent_action"];
  reply_text: string | null;
  lead_field_updates: Partial<
    Pick<
      LeadRow,
      | "name"
      | "email"
      | "vehicle_year"
      | "vehicle_make"
      | "vehicle_model"
      | "vehicle_mileage"
      | "vin"
      | "symptoms"
      | "notes"
    >
  > | null;
  proposed_lifecycle: Lifecycle | null;
  escalation_category: EscalationCategory | null;
  audit_summary: string;
  policy_tags: string[];
};

export class GrokDeniedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function systemPrompt(): string {
  return [
    "You are the SMS assistant for Boltz Automotive Inc., an independent auto repair shop in Chicago.",
    "You reply directly to customers by text. Be brief (under 320 characters), plain, and specific.",
    "",
    "Verified business facts — never contradict, never invent others:",
    `- Name: ${BUSINESS.name} (Google listing name Boltz Auto Inc.)`,
    `- Address: ${BUSINESS.address}`,
    `- Phone: ${BUSINESS.phone}`,
    `- Hours: ${BUSINESS.hours} (Sunday closed; last regular appointment about 4 PM)`,
    "- Specialty priority: engine replacement and major engine work.",
    "",
    "Hard rules:",
    "- Never promise prices, discounts, warranties, timelines, or parts availability. Say an inspection is required for a quote.",
    "- Never give legal, insurance-liability, or medical advice.",
    "- Never claim work is finished or a vehicle is ready unless the thread history says so.",
    "- Never ask for payment details, card numbers, SSNs, or financing information over text.",
    "- Never ask customers to mention keywords in reviews.",
    "- If the customer is threatening, injured, mentions lawyers/insurance liability/payment disputes, asks for a discount you cannot grant, or asks for a human: action must be 'escalate' with reply_text null.",
    "- Goal: collect year/make/model, mileage, symptoms, and whether the vehicle runs; then offer a drop-off inspection during business hours.",
    "",
    "Respond with JSON only, matching:",
    '{"action":"send"|"escalate"|"no_reply","reply_text":string|null,"lead_field_updates":object|null,',
    '"proposed_lifecycle":string|null,"escalation_category":string|null,"audit_summary":string,"policy_tags":string[]}',
  ].join("\n");
}

function leadSummary(lead: LeadRow): string {
  const parts = [
    `lifecycle: ${lead.lifecycle}`,
    `name: ${lead.name ?? "unknown"}`,
    `vehicle: ${[lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ") || "unknown"}`,
    `mileage: ${lead.vehicle_mileage ?? "unknown"}`,
    `symptoms: ${lead.symptoms ?? "unknown"}`,
    `consent: ${lead.consent_status}`,
  ];
  return parts.join("; ");
}

export async function decideReply(args: {
  lead: LeadRow;
  history: MessageRow[];
  inboundBody: string;
}): Promise<{ decision: AgentDecision; model: string; raw: unknown }> {
  const apiKey = requireSecret("XAI_API_KEY");
  const model = resolveModel();

  const messages = [
    { role: "system", content: systemPrompt() },
    { role: "system", content: `Current lead record — ${leadSummary(args.lead)}` },
    ...args.history.map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body ?? "",
    })),
    { role: "user", content: args.inboundBody },
  ];

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    const retryable = res.status === 429 || res.status >= 500;
    throw new GrokDeniedError(`xAI request failed (${res.status}): ${text}`, res.status, retryable);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  const decision = parseDecision(content);
  return { decision, model, raw: { content } };
}

export function parseDecision(content: string): AgentDecision {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {
      action: "escalate",
      reply_text: null,
      lead_field_updates: null,
      proposed_lifecycle: null,
      escalation_category: "other_high_risk",
      audit_summary: "Model returned unparseable output; escalated for human review.",
      policy_tags: ["unparseable_model_output"],
    };
  }

  const action = parsed["action"];
  const safeAction: AgentDecision["action"] =
    action === "send" || action === "escalate" || action === "no_reply" ? action : "escalate";

  return {
    action: safeAction,
    reply_text: typeof parsed["reply_text"] === "string" ? (parsed["reply_text"] as string) : null,
    lead_field_updates:
      parsed["lead_field_updates"] && typeof parsed["lead_field_updates"] === "object"
        ? (parsed["lead_field_updates"] as AgentDecision["lead_field_updates"])
        : null,
    proposed_lifecycle:
      typeof parsed["proposed_lifecycle"] === "string"
        ? (parsed["proposed_lifecycle"] as Lifecycle)
        : null,
    escalation_category:
      typeof parsed["escalation_category"] === "string"
        ? (parsed["escalation_category"] as EscalationCategory)
        : null,
    audit_summary:
      typeof parsed["audit_summary"] === "string" ? (parsed["audit_summary"] as string) : "",
    policy_tags: Array.isArray(parsed["policy_tags"])
      ? (parsed["policy_tags"] as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
  };
}
