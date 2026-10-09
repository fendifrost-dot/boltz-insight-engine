import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { shopChatReadSchema, shopMessageSchema } from "@/lib/desk-chat";
import { readShopChat, readShopSchedule, writeShopMessage } from "./chat.server";
import { z } from "zod";

export async function botReadShopChat(args: unknown) {
  return readShopChat(supabaseAdmin, shopChatReadSchema.parse(args));
}

export async function botPostShopMessage(agent: { id?: string; name: string }, args: unknown) {
  const parsed = shopMessageSchema.parse(args);
  const saved = await writeShopMessage(supabaseAdmin, {
    role: "agent",
    sender: agent.name,
    actor: `bot:${agent.id ?? agent.name}`,
    key: parsed.idempotencyKey,
    body: parsed.text,
    ...(agent.id ? { agentId: agent.id } : {}),
    replyTo: parsed.replyTo ?? null,
    leadId: parsed.leadId ?? null,
  });
  return {
    ok: true,
    messageId: saved.id,
    duplicate: !saved.created,
    channel: "internal_shop_chat",
    customerSmsSent: false,
  };
}

export async function botShopSchedule(args: unknown) {
  const parsed = z
    .object({
      date: z
        .string()
        .regex(/^20\d{2}-\d{2}-\d{2}$/)
        .optional(),
    })
    .strict()
    .parse(args);
  return readShopSchedule(supabaseAdmin, parsed.date);
}
