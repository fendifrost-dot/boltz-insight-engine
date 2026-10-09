import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/server/authz/require-capability.server";
import { shopMessageSchema } from "@/lib/desk-chat";
import { chicagoAppointmentIso } from "@/lib/desk-schedule";

export const getShopChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "contacts.read");
    const { readShopChat } = await import("@/server/desk/chat.server");
    const { readSecret } = await import("@/server/lead-inbox/env.server");
    return {
      ...(await readShopChat(context.supabase, { limit: 80 })),
      assistantReady: Boolean(readSecret("XAI_API_KEY")),
    };
  });

export const sendShopChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => shopMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "communications.draft");
    await requireCapability(context, "contacts.read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readShopChat, writeShopMessage, runStaffReadTool } =
      await import("@/server/desk/chat.server");
    if (data.leadId) {
      const lead = await context.supabase
        .from("leads")
        .select("id")
        .eq("id", data.leadId)
        .maybeSingle();
      if (lead.error || !lead.data) throw new Error("Customer not found.");
    }
    const history = await readShopChat(context.supabase, { limit: 12 });
    const saved = await writeShopMessage(supabaseAdmin, {
      role: "staff",
      sender: "Front desk",
      actor: `staff:${context.userId}`,
      key: data.idempotencyKey,
      staffUserId: context.userId,
      body: data.text,
      leadId: data.leadId ?? null,
      replyTo: data.replyTo ?? null,
    });
    if (!saved.created) {
      const response = await supabaseAdmin.from("desk_chat_messages").select("id").eq("reply_to", saved.id).in("role", ["assistant", "system"]).limit(1);
      if (response.error) throw new Error("Could not check the previous reply.");
      if (response.data?.length) return { ok: true, id: saved.id };
      const request = await supabaseAdmin.from("desk_chat_messages").select("created_at").eq("id", saved.id).single();
      if (request.error) throw new Error("Could not check the previous message.");
      // A retry may arrive while the original request is still answering. A stale
      // request can recover; the reply key below still prevents duplicate bubbles.
      if (Date.now() - Date.parse(request.data.created_at) < 35_000) return { ok: true, id: saved.id };
    }
    let body: string;
    let role: "assistant" | "system" = "assistant";
    try {
      const { replyToStaff } = await import("@/server/lead-inbox/grok.server");
      body = await replyToStaff({
        message: data.text,
        leadId: data.leadId ?? null,
        history: history.messages,
        read: (name, args) => runStaffReadTool(context.supabase, name, args),
      });
    } catch {
      role = "system";
      body =
        "Your message is saved in shop chat, but the instant assistant could not answer. You can still use Find a customer. Connected agents can read and reply here; a desktop agent may not be watching right now.";
      console.error("Shop chat instant reply unavailable");
    }
    await writeShopMessage(supabaseAdmin, {
      role,
      sender: role === "assistant" ? "Grok assistant" : "Shop chat",
      actor: "assistant",
      key: saved.id,
      body,
      replyTo: saved.id,
      leadId: data.leadId ?? null,
    });
    return { ok: true, id: saved.id };
  });

export const getShopSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "contacts.read");
    const { readShopSchedule } = await import("@/server/desk/chat.server");
    return readShopSchedule(context.supabase);
  });

export const saveShopAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        localTime: z.string().max(16).nullable(),
        expectedAppointmentAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    const appointmentAt = data.localTime ? chicagoAppointmentIso(data.localTime) : null;
    if (data.localTime && !appointmentAt)
      return { ok: false, reason: "Choose a valid date and time in Chicago." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
    const result = await rpc("set_desk_appointment", {
      _lead_id: data.leadId,
      _appointment_at: appointmentAt,
      _expected_appointment_at: data.expectedAppointmentAt,
      _actor: `staff:${context.userId}`,
    });
    if (result.error) throw new Error("Could not save the visit.");
    return result.data as { ok: boolean; reason?: string };
  });
