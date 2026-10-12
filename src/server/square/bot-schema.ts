import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const squareRevenueRequest = z
  .object({
    action: z.literal("square_revenue"),
    since: dateSchema.optional(),
    until: dateSchema.optional(),
  })
  .strict();

export const squarePaymentsRequest = z
  .object({
    action: z.literal("square_payments"),
    leadId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const squareDisputesRequest = z
  .object({
    action: z.literal("square_disputes"),
    disputeId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,192}$/)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
    dueWithinDays: z.number().int().min(1).max(30).optional(),
    state: z
      .string()
      .regex(/^[A-Z0-9_]{1,40}$/)
      .optional(),
  })
  .strict();
