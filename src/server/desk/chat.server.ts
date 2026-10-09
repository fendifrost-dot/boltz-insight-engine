import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { shopMessageKey, type ShopChatMessage } from "@/lib/desk-chat";
import {
  DESK_LEAD_LIST_COLUMNS,
  deskSearchOr,
  deskSearchPlan,
  toDeskLeadCard,
} from "@/lib/desk-intake";
import { shopDayBounds } from "@/lib/desk-schedule";

type Client = SupabaseClient<Database>;
const CHAT_COLUMNS = "id, sequence, created_at, role, sender, body, lead_id, reply_to" as const;

export async function readShopChat(
  client: Client,
  args: { after?: number | undefined; limit: number },
) {
  let query = client.from("desk_chat_messages").select(CHAT_COLUMNS);
  if (args.after !== undefined) query = query.gt("sequence", args.after);
  const { data, error } = await query
    .order("sequence", { ascending: args.after !== undefined })
    .limit(args.limit + 1);
  if (error) throw new Error("Could not load shop chat.");
  const rows = (data ?? []).slice(0, args.limit);
  if (args.after === undefined) rows.reverse();
  const messages: ShopChatMessage[] = rows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    createdAt: row.created_at,
    role: row.role,
    sender: row.sender,
    body: row.body,
    leadId: row.lead_id,
    replyTo: row.reply_to,
  }));
  return {
    messages,
    nextCursor: messages.at(-1)?.sequence ?? args.after ?? 0,
    hasMore: (data?.length ?? 0) > args.limit,
  };
}

export async function writeShopMessage(
  client: Client,
  args: {
    role: "staff" | "assistant" | "agent" | "system";
    sender: string;
    actor: string;
    key: string;
    body: string;
    staffUserId?: string;
    agentId?: string;
    leadId?: string | null;
    replyTo?: string | null;
  },
) {
  const key = shopMessageKey(args.actor, args.key);
  const { data, error } = await client
    .from("desk_chat_messages")
    .insert({
      role: args.role,
      sender: args.sender,
      body: args.body,
      idempotency_key: key,
      staff_user_id: args.staffUserId ?? null,
      agent_id: args.agentId ?? null,
      lead_id: args.leadId ?? null,
      reply_to: args.replyTo ?? null,
    })
    .select("id")
    .single();
  if (!error && data) return { id: data.id, created: true };
  if (error?.code === "23505") {
    const existing = await client
      .from("desk_chat_messages")
      .select("id")
      .eq("idempotency_key", key)
      .single();
    if (!existing.error && existing.data) return { id: existing.data.id, created: false };
  }
  throw new Error("Could not save the chat message.");
}

export async function readShopSchedule(client: Client, date?: string) {
  const bounds = shopDayBounds(date);
  const [booked, undated] = await Promise.all([
    client
      .from("leads")
      .select(DESK_LEAD_LIST_COLUMNS)
      .gte("appointment_at", bounds.start)
      .lt("appointment_at", bounds.end)
      .order("appointment_at")
      .limit(101),
    client
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("lifecycle", "Appointment Scheduled")
      .is("appointment_at", null),
  ]);
  if (booked.error || undated.error) throw new Error("Could not read the shop schedule.");
  return {
    date: bounds.date,
    timeZone: "America/Chicago",
    visits: (booked.data ?? []).slice(0, 100).map(toDeskLeadCard),
    truncated: (booked.data?.length ?? 0) > 100,
    missingDates: undated.count ?? 0,
  };
}

/** All assistant reads use the receptionist's JWT and the existing RLS policies. */
export async function runStaffReadTool(
  client: Client,
  name: string,
  raw: unknown,
): Promise<unknown> {
  if (name === "find_customers") {
    const { query } = z
      .object({ query: z.string().min(1).max(80) })
      .strict()
      .parse(raw);
    const plan = deskSearchPlan(query);
    if (!plan.phoneExact && !plan.text && !plan.phoneDigits)
      return { customers: [], reason: "Enter a name or phone number." };
    let request = client.from("leads").select(DESK_LEAD_LIST_COLUMNS);
    if (plan.phoneExact) request = request.eq("phone_e164", plan.phoneExact);
    else {
      const filter = deskSearchOr(plan);
      if (filter) request = request.or(filter);
    }
    const result = await request.order("created_at", { ascending: false }).limit(11);
    if (result.error) throw new Error("Customer search is unavailable.");
    return {
      customers: (result.data ?? []).slice(0, 10).map(toDeskLeadCard),
      truncated: (result.data?.length ?? 0) > 10,
    };
  }
  if (name === "shop_schedule") {
    const { date } = z
      .object({
        date: z
          .string()
          .regex(/^20\d{2}-\d{2}-\d{2}$/)
          .optional(),
      })
      .strict()
      .parse(raw);
    return readShopSchedule(client, date);
  }
  if (name === "customer_details") {
    const { leadId } = z.object({ leadId: z.string().uuid() }).strict().parse(raw);
    const lead = await client
      .from("leads")
      .select(DESK_LEAD_LIST_COLUMNS)
      .eq("id", leadId)
      .maybeSingle();
    if (lead.error) throw new Error("Customer details are unavailable.");
    if (!lead.data) return { found: false };
    const messages = await client
      .from("messages")
      .select("direction, body, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (messages.error) throw new Error("Customer text history is unavailable.");
    return { customer: toDeskLeadCard(lead.data), recentTexts: messages.data?.reverse() ?? [] };
  }
  throw new Error("This assistant can only read customer information and the shop schedule.");
}
