import { z } from "zod";
import { AGENT_ACTIONS, ESCALATION_CATEGORIES, LEAD_LIFECYCLES } from "@/lib/lead-inbox/constants";

export const grokLeadFieldUpdatesSchema = z
  .object({
    name: z.string().min(1).nullable().optional(),
    email: z.string().email().nullable().optional(),
    vehicle_year: z.number().int().min(1900).max(2100).nullable().optional(),
    vehicle_make: z.string().min(1).nullable().optional(),
    vehicle_model: z.string().min(1).nullable().optional(),
    vehicle_mileage: z.number().int().min(0).nullable().optional(),
    vin: z.string().min(5).max(32).nullable().optional(),
    symptoms: z.string().min(1).nullable().optional(),
    notes: z.string().min(1).nullable().optional(),
  })
  .strict();

export const grokDecisionSchema = z
  .object({
    action: z.enum(AGENT_ACTIONS),
    message: z.string().nullable(),
    lead_field_updates: grokLeadFieldUpdatesSchema.nullable(),
    proposed_lifecycle: z.enum(LEAD_LIFECYCLES).nullable(),
    tags: z.array(z.string()),
    escalation_category: z.enum(ESCALATION_CATEGORIES).nullable(),
    audit_summary: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.action === "send" && (!val.message || !val.message.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "send action requires a non-empty message",
        path: ["message"],
      });
    }
    if (val.action === "escalate" && !val.escalation_category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "escalate action requires escalation_category",
        path: ["escalation_category"],
      });
    }
  });

export type GrokDecision = z.infer<typeof grokDecisionSchema>;

export const GROK_DECISION_JSON_SCHEMA = {
  name: "boltz_lead_sms_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "action",
      "message",
      "lead_field_updates",
      "proposed_lifecycle",
      "tags",
      "escalation_category",
      "audit_summary",
    ],
    properties: {
      action: { type: "string", enum: [...AGENT_ACTIONS] },
      message: { type: ["string", "null"] },
      lead_field_updates: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
              vehicle_year: { type: ["integer", "null"] },
              vehicle_make: { type: ["string", "null"] },
              vehicle_model: { type: ["string", "null"] },
              vehicle_mileage: { type: ["integer", "null"] },
              vin: { type: ["string", "null"] },
              symptoms: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
            },
          },
        ],
      },
      proposed_lifecycle: {
        anyOf: [{ type: "null" }, { type: "string", enum: [...LEAD_LIFECYCLES] }],
      },
      tags: { type: "array", items: { type: "string" } },
      escalation_category: {
        anyOf: [{ type: "null" }, { type: "string", enum: [...ESCALATION_CATEGORIES] }],
      },
      audit_summary: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
} as const;
