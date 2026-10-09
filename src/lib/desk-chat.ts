import { z } from "zod";

export const shopMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().uuid(),
    leadId: z.string().uuid().nullable().optional(),
    replyTo: z.string().uuid().nullable().optional(),
  })
  .strict();

export const shopChatReadSchema = z
  .object({
    after: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).default(60),
  })
  .strict();

export type ShopChatMessage = {
  id: string;
  sequence: number;
  createdAt: string;
  role: string;
  sender: string;
  body: string;
  leadId: string | null;
  replyTo: string | null;
};

export function shopMessageKey(actor: string, key: string): string {
  return `${actor}:${key}`;
}
