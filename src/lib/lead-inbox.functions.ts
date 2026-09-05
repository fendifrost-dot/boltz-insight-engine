import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Constants } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONSENT_BASIS, buildConsentLeadUpdate, validateConsentOptIn } from "@/lib/start-owner-sms-policy";
import { LIFECYCLE_EVIDENCE_BASIS, requiresFinancialConfirm } from "@/lib/lifecycle-transitions";
import { checkCapability, requireCapability, requireOwner } from "@/server/authz/require-capability.server";

/**
 * Server-fn authorization audit (createServerFn handlers in this module):
 * - listLeads, getThread, listEscalations, updateEscalation, setThreadControl: authenticated client + RLS only.
 * - sendOwnerMessage, startOwnerSms: service-role outbound path → requireCapability("communications.send").
 * - transitionLeadLifecycle: cases.transition; financial_status.confirm when touching Paid; owner vs staff actor.
 * - getIntegrationHealth, resumeAgentFn, ensureSubscription: secrets/provider/integration → integrations.manage (owner).
 */

export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { data, error } = await context.supabase
        .from("leads")
        .select(
          "id, name, phone_e164, lifecycle, consent_status, vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, symptoms, lead_source, last_inbound_at, last_outbound_at, last_message_at, unread_count, created_at",
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .limit(200);

      if (error) throw new Error(error.message);
      return data ?? [];
    } catch (error) {
      console.error("listLeads failed", error);
      return [];
    }
  });

export const getThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [leadRes, threadRes] = await Promise.all([
      context.supabase.from("leads").select("*").eq("id", data.leadId).maybeSingle(),
      context.supabase
        .from("message_threads")
        .select("*")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    if (leadRes.error) throw new Error(leadRes.error.message);
    if (threadRes.error) throw new Error(threadRes.error.message);

    const thread = threadRes.data;
    const [messagesRes, runsRes, eventsRes] = await Promise.all([
      thread
        ? context.supabase
            .from("messages")
            .select("*")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: true })
            .limit(200)
        : Promise.resolve({ data: [], error: null } as const),
      context.supabase
        .from("agent_runs")
        .select("*")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("lead_events")
        .select("*")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    return {
      lead: leadRes.data,
      thread,
      messages: messagesRes.data ?? [],
      agentRuns: runsRes.data ?? [],
      events: eventsRes.data ?? [],
    };
  });

export const setThreadControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ threadId: z.string().uuid(), mode: z.enum(["auto", "human"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("message_threads")
      .update({ control_mode: data.mode })
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true, mode: data.mode };
  });

export const sendOwnerMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        threadId: z.string().uuid(),
        text: z.string().min(1).max(480),
        expectedPhone: z.string().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "communications.send");

    const [leadRes, threadRes] = await Promise.all([
      context.supabase
        .from("leads")
        .select("id, phone_e164, consent_status")
        .eq("id", data.leadId)
        .single(),
      context.supabase
        .from("message_threads")
        .select("id, lead_id, phone_e164")
        .eq("id", data.threadId)
        .single(),
    ]);
    if (leadRes.error) throw new Error(leadRes.error.message);
    if (threadRes.error) throw new Error(threadRes.error.message);
    const lead = leadRes.data;
    const thread = threadRes.data;

    if (thread.lead_id !== lead.id) {
      return { ok: false as const, reason: "Thread does not belong to the selected lead — send blocked" };
    }
    if (!lead.phone_e164) return { ok: false as const, reason: "Lead has no phone number" };
    if (lead.consent_status === "opted_out") {
      return { ok: false as const, reason: "Lead has opted out of texts" };
    }

    const { toE164 } = await import("@/server/lead-inbox/store.server");
    const leadPhone = toE164(lead.phone_e164);
    if (thread.phone_e164 && toE164(thread.phone_e164) !== leadPhone) {
      return { ok: false as const, reason: "Lead phone and thread phone disagree — send blocked" };
    }
    if (data.expectedPhone && toE164(data.expectedPhone) !== leadPhone) {
      return {
        ok: false as const,
        reason: "Destination phone does not match the visible conversation — send blocked",
      };
    }

    const { sendOutbound } = await import("@/server/lead-inbox/outbound.server");
    const outcome = await sendOutbound({
      leadId: lead.id,
      threadId: thread.id,
      to: leadPhone,
      text: data.text,
      idempotencyKey: `owner:${thread.id}:${Date.now()}`,
      actor: `owner:${context.userId}`,
    });
    return outcome.ok
      ? { ok: true as const, reason: null }
      : { ok: false as const, reason: outcome.reason };
  });


export const listEscalations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("escalations")
      .select("*, leads(name, phone_e164, lifecycle)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateEscalation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "acknowledged", "resolved"]),
        notes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("escalations")
      .update({
        status: data.status,
        resolution_notes: data.notes ?? null,
        resolved_at: data.status === "resolved" ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getIntegrationHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "integrations.manage");

    try {
      const { secretStatus } = await import("@/server/lead-inbox/env.server");
      const { agentCircuitState } = await import("@/server/lead-inbox/jobs.server");
      const { storedAgentSecretConfigured } = await import("@/server/agent-auth.server");

      // AGENT_AUTH_* may live in the database vault rather than env — report
      // the resolved presence so vault-configured secrets don't read "Missing".
      const secrets = await Promise.all(
        secretStatus().map(async (entry) =>
          entry.name === "AGENT_AUTH_EMAIL" || entry.name === "AGENT_AUTH_PASSWORD"
            ? { ...entry, configured: await storedAgentSecretConfigured(entry.name) }
            : entry,
        ),
      );

      const [snapshotsRes, subsRes, jobsRes] = await Promise.all([
      context.supabase
        .from("integration_health_snapshots")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(40),
      context.supabase
        .from("ringcentral_subscriptions")
        .select("id, provider_subscription_id, status, expires_at, delivery_address, last_renewed_at, last_renewal_error, sms_capability")
        .order("created_at", { ascending: false })
        .limit(5),
      context.supabase
        .from("message_jobs")
        .select("id, job_type, status, attempts, last_error, run_after, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

      let capability: { capability: string; detail: string } | null = null;
      try {
        const { cachedCapability } = await import("@/server/lead-inbox/outbound.server");
        const result = await cachedCapability();
        capability = { capability: result.capability, detail: result.detail };
      } catch (error) {
        capability = {
          capability: "unknown",
          detail: error instanceof Error ? error.message.slice(0, 300) : "capability check failed",
        };
      }

      return {
        secrets: secretStatus(),
        circuit: await agentCircuitState(),
        capability,
        snapshots: snapshotsRes.data ?? [],
        subscriptions: subsRes.data ?? [],
        jobs: jobsRes.data ?? [],
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Missing capability:")) {
        throw error;
      }
      console.error("getIntegrationHealth failed", error);
      return {
        secrets: [],
        circuit: { paused: true, detail: "Integration health unavailable" },
        capability: { capability: "unknown", detail: "Integration health unavailable" },
        snapshots: [],
        subscriptions: [],
        jobs: [],
      };
    }
  });

const consentEvidenceSchema = z.object({
  basis: z.enum(CONSENT_BASIS),
  note: z.string().max(500).optional(),
  evidenceRef: z.string().max(200).optional(),
});

export const startOwnerSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().min(1),
        text: z.string().min(1).max(480),
        name: z.string().max(200).optional(),
        vehicleYear: z.coerce.number().int().min(1900).max(2100).optional(),
        vehicleMake: z.string().max(100).optional(),
        vehicleModel: z.string().max(100).optional(),
        leadSource: z.string().max(100).optional(),
        markConsentOptIn: z.boolean().default(false),
        consentEvidence: consentEvidenceSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "communications.send");

    const consentCheck = validateConsentOptIn({
      markConsentOptIn: data.markConsentOptIn,
      consentEvidence: data.consentEvidence,
    });
    if (!consentCheck.ok) {
      return { ok: false as const, reason: consentCheck.reason, leadId: null };
    }

    const { getOrCreateLeadThread, toE164, addEvent } = await import("@/server/lead-inbox/store.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendOutbound } = await import("@/server/lead-inbox/outbound.server");

    const normalized = toE164(data.phone);
    const digitCount = normalized.replace(/\D/g, "").length;
    if (digitCount < 10 || digitCount > 15) {
      return { ok: false as const, reason: "Invalid phone number digit count", leadId: null };
    }

    const leadSource = data.leadSource?.trim() || "owner_outbound";
    const { lead, thread } = await getOrCreateLeadThread(normalized, leadSource);

    if (lead.consent_status === "opted_out") {
      return { ok: false as const, reason: "Lead has opted out of texts", leadId: lead.id };
    }

    const leadUpdate: Record<string, unknown> = {};
    if (data.name?.trim()) leadUpdate["name"] = data.name.trim();
    if (data.vehicleYear !== undefined) leadUpdate["vehicle_year"] = data.vehicleYear;
    if (data.vehicleMake?.trim()) leadUpdate["vehicle_make"] = data.vehicleMake.trim();
    if (data.vehicleModel?.trim()) leadUpdate["vehicle_model"] = data.vehicleModel.trim();

    const consentUpdate = buildConsentLeadUpdate({
      markConsentOptIn: data.markConsentOptIn,
      consentEvidence: data.consentEvidence,
      leadSource,
      actorUserId: context.userId,
      currentConsentStatus: lead.consent_status,
    });
    if (consentUpdate) {
      Object.assign(leadUpdate, consentUpdate);
    }

    if (Object.keys(leadUpdate).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("leads")
        .update(leadUpdate as never)
        .eq("id", lead.id);
      if (updateError) throw new Error(updateError.message);

      if (consentUpdate) {
        await addEvent(
          lead.id,
          "consent_opted_in",
          "SMS consent marked opted in for owner-started thread",
          `owner:${context.userId}`,
          {
            basis: data.consentEvidence?.basis,
            evidence_ref: data.consentEvidence?.evidenceRef ?? null,
            lead_source: leadSource,
          },
        );
      }
    }

    const { error: threadError } = await supabaseAdmin
      .from("message_threads")
      .update({ control_mode: "human" })
      .eq("id", thread.id);
    if (threadError) throw new Error(threadError.message);

    const actor = `staff:${context.userId}`;
    await addEvent(lead.id, "owner_outbound_started", "Staff started outbound SMS thread", actor, {
      thread_id: thread.id,
      text_length: data.text.length,
      consent_status: consentUpdate ? "opted_in" : lead.consent_status,
    });

    const outcome = await sendOutbound({
      leadId: lead.id,
      threadId: thread.id,
      to: normalized,
      text: data.text,
      idempotencyKey: `owner-new:${thread.id}:${Date.now()}`,
      actor,
    });

    return outcome.ok
      ? { ok: true as const, reason: null as string | null, leadId: lead.id }
      : { ok: false as const, reason: outcome.reason, leadId: lead.id };
  });

const lifecycleEvidenceSchema = z.object({
  basis: z.enum(LIFECYCLE_EVIDENCE_BASIS),
  note: z.string().max(500).optional(),
  evidenceRef: z.string().max(200).optional(),
});

export const transitionLeadLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        toLifecycle: z.enum(Constants.public.Enums.lead_lifecycle),
        evidence: lifecycleEvidenceSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "cases.transition");

    const { applyLifecycleTransition } = await import("@/server/lead-inbox/lifecycle.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .select("id, lifecycle")
      .eq("id", data.leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return { ok: false as const, reason: "Lead not found", applied: false as const };

    if (requiresFinancialConfirm(lead.lifecycle, data.toLifecycle)) {
      await requireCapability(context, "financial_status.confirm");
    }

    const isOwner = await checkCapability(context, "integrations.manage");
    const actor = isOwner ? `owner:${context.userId}` : `staff:${context.userId}`;
    const result = await applyLifecycleTransition({
      leadId: lead.id,
      fromLifecycle: lead.lifecycle,
      toLifecycle: data.toLifecycle,
      actor,
      evidence: {
        basis: data.evidence.basis,
        evidenceRef: data.evidence.evidenceRef,
        note: data.evidence.note,
        assertedBy: context.userId,
      },
      summary: `${isOwner ? "Owner" : "Staff"} moved lifecycle to ${data.toLifecycle}`,
    });

    if (!result.ok) {
      return {
        ok: false as const,
        reason: result.reason,
        applied: false as const,
        code: result.code,
      };
    }
    if (!result.applied) {
      return { ok: true as const, reason: null as string | null, applied: false as const };
    }
    return { ok: true as const, reason: null as string | null, applied: true as const };
  });

export const resumeAgentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const { resumeAgent } = await import("@/server/lead-inbox/jobs.server");
    await resumeAgent(`Resumed by owner ${context.userId}`);
    return { ok: true };
  });

export const ensureSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const { renewSubscriptions } = await import("@/server/lead-inbox/cron.server");
    try {
      return { ok: true as const, result: await renewSubscriptions(), error: null };
    } catch (error) {
      return {
        ok: false as const,
        result: null,
        error: error instanceof Error ? error.message.slice(0, 400) : "subscription setup failed",
      };
    }
  });
