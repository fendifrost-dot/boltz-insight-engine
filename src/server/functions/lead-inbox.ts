import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createSmsWebhookSubscription,
  getAuthenticatedExtension,
  resolveFromNumberCapability,
} from "@/integrations/ringcentral/client.server";
import { LEAD_LIFECYCLES, THREAD_CONTROL_MODES, isLeadLifecycle } from "@/lib/lead-inbox/constants";
import { getPublicAppUrl, getRingCentralConfig } from "@/lib/server/env.server";
import { normalizeToE164 } from "@/lib/server/phone.server";
import { getIntegrationHealth } from "@/server/lead-inbox/health.server";
import { retryJobSafely } from "@/server/lead-inbox/jobs.server";
import { recordLeadEvent, sendOutboundSms, transitionLeadLifecycle } from "@/server/lead-inbox/outbound.server";

const authMiddleware = [requireSupabaseAuth] as const;

export const listLeadsFn = createServerFn({ method: "GET" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      lifecycle: z.string().optional(),
      unreadOnly: z.boolean().optional(),
      source: z.string().optional(),
      controlMode: z.enum(THREAD_CONTROL_MODES).optional(),
      escalatedOnly: z.boolean().optional(),
      q: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let query = context.supabase
      .from("leads")
      .select(
        "id, name, phone_e164, email, vehicle_year, vehicle_make, vehicle_model, lead_source, lifecycle, unread_count, last_message_at, consent_status, created_at",
        { count: "exact" },
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (data.lifecycle && isLeadLifecycle(data.lifecycle)) {
      query = query.eq("lifecycle", data.lifecycle);
    }
    if (data.unreadOnly) {
      query = query.gt("unread_count", 0);
    }
    if (data.source) {
      query = query.eq("lead_source", data.source);
    }
    if (data.q) {
      const q = data.q.trim();
      query = query.or(`name.ilike.%${q}%,phone_e164.ilike.%${q}%,email.ilike.%${q}%`);
    }

    const { data: leads, error, count } = await query;
    if (error) throw new Error(error.message);

    const leadIds = (leads ?? []).map((l) => l.id);
    const { data: threads } =
      leadIds.length > 0
        ? await context.supabase
            .from("message_threads")
            .select("id, lead_id, control_mode, last_message_at")
            .in("lead_id", leadIds)
        : { data: [] as Array<{ id: string; lead_id: string; control_mode: string; last_message_at: string | null }> };

    let escalatedLeadIds = new Set<string>();
    if (data.escalatedOnly || true) {
      const { data: esc } = await context.supabase
        .from("escalations")
        .select("lead_id")
        .eq("status", "open");
      escalatedLeadIds = new Set((esc ?? []).map((e) => e.lead_id));
    }

    let items = (leads ?? []).map((lead) => {
      const thread = (threads ?? []).find((t) => t.lead_id === lead.id) ?? null;
      return {
        ...lead,
        threadId: thread?.id ?? null,
        controlMode: thread?.control_mode ?? "auto",
        hasOpenEscalation: escalatedLeadIds.has(lead.id),
      };
    });

    if (data.controlMode) {
      items = items.filter((i) => i.controlMode === data.controlMode);
    }
    if (data.escalatedOnly) {
      items = items.filter((i) => i.hasOpenEscalation);
    }

    return { items, total: count ?? items.length, page: data.page, pageSize: data.pageSize };
  });

export const getLeadThreadFn = createServerFn({ method: "GET" })
  .middleware(authMiddleware)
  .validator(z.object({ leadId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { data: lead, error } = await context.supabase.from("leads").select("*").eq("id", data.leadId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Lead not found");

    const { data: thread } = await context.supabase
      .from("message_threads")
      .select("*")
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: messages } = thread
      ? await context.supabase
          .from("messages")
          .select(
            "id, direction, body, channel, delivery_state, created_at, provider_created_at, error_code, attachment_urls, sender_e164",
          )
          .eq("thread_id", thread.id)
          .order("created_at", { ascending: true })
      : { data: [] };

    const { data: events } = await context.supabase
      .from("lead_events")
      .select("id, created_at, event_type, from_lifecycle, to_lifecycle, actor, summary")
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: escalations } = await context.supabase
      .from("escalations")
      .select("*")
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: false });

    // Mark read
    await context.supabase.from("leads").update({ unread_count: 0 }).eq("id", data.leadId);
    if (thread) {
      await context.supabase.from("message_threads").update({ unread_count: 0 }).eq("id", thread.id);
    }

    return { lead, thread, messages: messages ?? [], events: events ?? [], escalations: escalations ?? [] };
  });

export const sendManualMessageFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      leadId: z.string().uuid(),
      threadId: z.string().uuid(),
      body: z.string().min(1).max(1600),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: lead } = await context.supabase
      .from("leads")
      .select("phone_e164")
      .eq("id", data.leadId)
      .single();
    if (!lead?.phone_e164) throw new Error("Lead phone not entered");

    const result = await sendOutboundSms({
      leadId: data.leadId,
      threadId: data.threadId,
      toE164: lead.phone_e164,
      body: data.body,
      actor: `user:${context.userId}`,
    });
    return result;
  });

export const startConversationFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      leadId: z.string().uuid().optional(),
      phone: z.string().min(7),
      name: z.string().optional(),
      body: z.string().min(1).max(1600),
      consentConfirmed: z.literal(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const phone = normalizeToE164(data.phone);
    if (!phone) throw new Error("Invalid phone number");

    let leadId = data.leadId ?? null;
    if (!leadId) {
      const { data: existing } = await context.supabase
        .from("leads")
        .select("id")
        .eq("phone_e164", phone)
        .maybeSingle();
      if (existing?.id) {
        leadId = existing.id;
      } else {
        const { data: created, error } = await context.supabase
          .from("leads")
          .insert({
            phone_e164: phone,
            name: data.name ?? null,
            consent_status: "opted_in",
            consent_updated_at: new Date().toISOString(),
            consent_evidence: {
              type: "owner_confirmed",
              at: new Date().toISOString(),
              actor: context.userId,
            },
            lead_source: "manual_outbound",
            lifecycle: "New",
          })
          .select("id")
          .single();
        if (error || !created) throw new Error(error?.message ?? "Failed to create lead");
        leadId = created.id;
        await recordLeadEvent({
          leadId,
          eventType: "lead_created",
          actor: `user:${context.userId}`,
          summary: "Lead created for new consented conversation",
          toLifecycle: "New",
        });
      }
    }

    await context.supabase
      .from("leads")
      .update({
        consent_status: "opted_in",
        consent_updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    let threadId: string;
    const { data: thread } = await context.supabase
      .from("message_threads")
      .select("id")
      .eq("lead_id", leadId)
      .eq("phone_e164", phone)
      .maybeSingle();

    if (thread?.id) {
      threadId = thread.id;
    } else {
      const { data: createdThread, error } = await context.supabase
        .from("message_threads")
        .insert({ lead_id: leadId, phone_e164: phone, control_mode: "human" })
        .select("id")
        .single();
      if (error || !createdThread) throw new Error(error?.message ?? "Failed to create thread");
      threadId = createdThread.id;
    }

    const sent = await sendOutboundSms({
      leadId,
      threadId,
      toE164: phone,
      body: data.body,
      actor: `user:${context.userId}`,
    });

    return { leadId, threadId, ...sent };
  });

export const updateLeadFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      leadId: z.string().uuid(),
      name: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      vehicle_year: z.number().int().nullable().optional(),
      vehicle_make: z.string().nullable().optional(),
      vehicle_model: z.string().nullable().optional(),
      vehicle_mileage: z.number().int().nullable().optional(),
      vin: z.string().nullable().optional(),
      symptoms: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      assigned_owner: z.string().nullable().optional(),
      follow_up_at: z.string().nullable().optional(),
      lifecycle: z.enum(LEAD_LIFECYCLES).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { leadId, lifecycle, ...fields } = data;
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) updates[k] = v;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await context.supabase.from("leads").update(updates).eq("id", leadId);
      if (error) throw new Error(error.message);
      await recordLeadEvent({
        leadId,
        eventType: "lead_updated",
        actor: `user:${context.userId}`,
        summary: "Lead details updated",
        metadata: { fields: Object.keys(updates) },
      });
    }

    if (lifecycle) {
      await transitionLeadLifecycle({
        leadId,
        to: lifecycle,
        actor: `user:${context.userId}`,
        summary: `Owner set lifecycle to ${lifecycle}`,
      });
    }

    return { ok: true };
  });

export const setThreadControlModeFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      threadId: z.string().uuid(),
      mode: z.enum(THREAD_CONTROL_MODES),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: thread, error } = await context.supabase
      .from("message_threads")
      .update({ control_mode: data.mode })
      .eq("id", data.threadId)
      .select("id, lead_id, control_mode")
      .single();
    if (error || !thread) throw new Error(error?.message ?? "Thread not found");

    await recordLeadEvent({
      leadId: thread.lead_id,
      eventType: "thread_control_mode",
      actor: `user:${context.userId}`,
      summary: `Thread control set to ${data.mode}`,
    });

    return thread;
  });

export const listEscalationsFn = createServerFn({ method: "GET" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      status: z.enum(["open", "acknowledged", "resolved"]).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("escalations")
      .select("*, leads(name, phone_e164, lifecycle)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const resolveEscalationFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .validator(
    z.object({
      escalationId: z.string().uuid(),
      status: z.enum(["acknowledged", "resolved"]),
      resolutionNotes: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("escalations")
      .update({
        status: data.status,
        resolution_notes: data.resolutionNotes ?? null,
        resolved_at: data.status === "resolved" ? new Date().toISOString() : null,
      })
      .eq("id", data.escalationId);
    if (error) throw new Error(error.message);
    return { ok: true, actor: context.userId };
  });

export const getIntegrationHealthFn = createServerFn({ method: "GET" })
  .middleware(authMiddleware)
  .handler(async () => getIntegrationHealth());

export const retryFailedJobFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data }) => retryJobSafely(data.jobId));

export const getLeadDashboardCountsFn = createServerFn({ method: "GET" })
  .middleware(authMiddleware)
  .handler(async ({ context }) => {
    const lifecycles = ["New", "Contacted", "Qualified", "Appointment Scheduled"] as const;
    const counts: Record<string, number> = {};
    for (const lc of lifecycles) {
      const { count } = await context.supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle", lc);
      counts[lc] = count ?? 0;
    }
    const { count: unread } = await context.supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gt("unread_count", 0);
    const { count: escalated } = await context.supabase
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    return {
      New: counts["New"] ?? 0,
      Unread: unread ?? 0,
      Contacted: counts["Contacted"] ?? 0,
      Qualified: counts["Qualified"] ?? 0,
      "Appointment Scheduled": counts["Appointment Scheduled"] ?? 0,
      Escalated: escalated ?? 0,
    };
  });

export const createRingCentralSubscriptionFn = createServerFn({ method: "POST" })
  .middleware(authMiddleware)
  .handler(async () => {
    const config = getRingCentralConfig();
    const base = getPublicAppUrl();
    if (!base) {
      throw new Error("PUBLIC_APP_URL must be set to a stable deployed URL before creating the webhook");
    }
    const deliveryAddress = `${base.replace(/\/$/, "")}/api/ringcentral/webhook`;
    const ext = await getAuthenticatedExtension();
    const { capability } = await resolveFromNumberCapability();
    const sub = await createSmsWebhookSubscription({
      deliveryAddress,
      verificationToken: config.webhookValidationToken,
    });

    const { error } = await supabaseAdmin.from("ringcentral_subscriptions").upsert(
      {
        provider_subscription_id: sub.id,
        event_filters: sub.eventFilters,
        delivery_address: deliveryAddress,
        status: sub.status,
        expires_at: sub.expiresAt,
        last_renewed_at: new Date().toISOString(),
        sms_capability: capability,
        from_number_e164: config.fromNumber,
        extension_id: ext.id,
        metadata_redacted: { transportType: sub.deliveryMode.transportType },
      },
      { onConflict: "provider_subscription_id" },
    );
    if (error) throw new Error(error.message);

    return {
      subscriptionId: sub.id,
      expiresAt: sub.expiresAt,
      deliveryAddress,
      smsCapability: capability,
      extensionId: ext.id,
    };
  });
