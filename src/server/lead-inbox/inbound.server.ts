/**
 * Idempotent inbound RingCentral notification ingestion + Grok processing.
 * Never logs message body or credentials.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getMessageStoreRecord,
  resolveFromNumberCapability,
} from "@/integrations/ringcentral/client.server";
import { runLeadSmsAgent } from "@/integrations/xai/agent.server";
import type { LeadLifecycle } from "@/lib/lead-inbox/constants";
import { isOptInMessage, isOptOutMessage } from "@/lib/server/consent.server";
import { getRingCentralConfig } from "@/lib/server/env.server";
import { normalizeToE164, phonesEqual } from "@/lib/server/phone.server";
import { enqueueInboundProcessJob } from "./jobs.server";
import { recordLeadEvent, sendOutboundSms, transitionLeadLifecycle } from "./outbound.server";

type InstantSmsBody = {
  uuid?: string;
  event?: string;
  timestamp?: string;
  subscriptionId?: string;
  body?: {
    id?: string | number;
    type?: string;
    subject?: string;
    direction?: string;
    from?: { phoneNumber?: string };
    to?: Array<{ phoneNumber?: string }>;
    creationTime?: string;
    lastModifiedTime?: string;
    messageStatus?: string;
  };
};

function extractProviderMessageId(payload: InstantSmsBody): string | null {
  if (payload.body?.id != null) return String(payload.body.id);
  return null;
}

export async function ingestRingCentralWebhook(payload: InstantSmsBody): Promise<{
  accepted: boolean;
  duplicate: boolean;
  ignored: boolean;
  reason?: string;
  jobId?: string;
}> {
  const providerMessageId = extractProviderMessageId(payload);
  if (!providerMessageId) {
    return { accepted: false, duplicate: false, ignored: true, reason: "missing_message_id" };
  }

  const config = getRingCentralConfig();
  const ourNumber = normalizeToE164(config.fromNumber);

  const directionRaw = (payload.body?.direction ?? "").toLowerCase();
  const fromRaw = payload.body?.from?.phoneNumber ?? null;
  const toList = (payload.body?.to ?? []).map((t) => t.phoneNumber).filter(Boolean) as string[];

  // Ignore messages not involving our from-number.
  const involvesUs =
    phonesEqual(fromRaw, ourNumber) || toList.some((t) => phonesEqual(t, ourNumber));
  if (!involvesUs) {
    return { accepted: false, duplicate: false, ignored: true, reason: "unrelated_number" };
  }

  // Only process inbound for autonomous agent queue.
  const isInbound = directionRaw === "inbound";
  if (!isInbound) {
    // Still upsert outbound delivery state if we can match provider id.
    await upsertOutboundDeliveryHint(providerMessageId, payload);
    return { accepted: true, duplicate: false, ignored: true, reason: "outbound_delivery_only" };
  }

  const sender = normalizeToE164(fromRaw);
  if (!sender) {
    return { accepted: false, duplicate: false, ignored: true, reason: "invalid_sender" };
  }

  let bodyText = payload.body?.subject ?? null;
  let channel: "SMS" | "MMS" = payload.body?.type === "MMS" ? "MMS" : "SMS";

  if (bodyText == null || bodyText === "") {
    try {
      const full = await getMessageStoreRecord(providerMessageId);
      bodyText = full.subject ?? null;
      if (full.type === "MMS") channel = "MMS";
    } catch {
      // Continue with null body; processor may retry after fetch.
    }
  }

  const { leadId, threadId, messageId, created } = await upsertInboundMessage({
    providerMessageId,
    sender,
    ourNumber: ourNumber!,
    bodyText,
    channel,
    providerCreatedAt: payload.body?.creationTime ?? null,
  });

  if (!created) {
    // Idempotent: ensure a job exists but do not double-create agent work if already processed.
    const { jobId, created: jobCreated } = await enqueueInboundProcessJob({
      providerMessageId,
      leadId,
      threadId,
      messageId,
      payload: { source: "webhook_duplicate" },
    });
    return {
      accepted: true,
      duplicate: true,
      ignored: false,
      jobId,
      reason: jobCreated ? "duplicate_message_job_ensured" : "duplicate_message",
    };
  }

  const { jobId } = await enqueueInboundProcessJob({
    providerMessageId,
    leadId,
    threadId,
    messageId,
    payload: { source: "webhook" },
  });

  await supabaseAdmin
    .from("ringcentral_subscriptions")
    .update({ last_notification_at: new Date().toISOString() })
    .eq("provider_subscription_id", payload.subscriptionId ?? "");

  return { accepted: true, duplicate: false, ignored: false, jobId };
}

async function upsertOutboundDeliveryHint(providerMessageId: string, payload: InstantSmsBody) {
  const status = payload.body?.messageStatus ?? null;
  if (!status) return;
  const delivery =
    status === "Delivered"
      ? "delivered"
      : status === "Sent"
        ? "sent"
        : status.toLowerCase().includes("fail")
          ? "failed"
          : null;
  if (!delivery) return;
  await supabaseAdmin
    .from("messages")
    .update({
      delivery_state: delivery,
      provider_updated_at: payload.body?.lastModifiedTime ?? new Date().toISOString(),
    })
    .eq("provider", "ringcentral")
    .eq("provider_message_id", providerMessageId);
}

async function upsertInboundMessage(input: {
  providerMessageId: string;
  sender: string;
  ourNumber: string;
  bodyText: string | null;
  channel: "SMS" | "MMS";
  providerCreatedAt: string | null;
}): Promise<{ leadId: string; threadId: string; messageId: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("messages")
    .select("id, lead_id, thread_id")
    .eq("provider", "ringcentral")
    .eq("provider_message_id", input.providerMessageId)
    .maybeSingle();

  if (existing?.id) {
    return {
      leadId: existing.lead_id,
      threadId: existing.thread_id,
      messageId: existing.id,
      created: false,
    };
  }

  let leadId: string;
  const { data: existingLead } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("phone_e164", input.sender)
    .maybeSingle();

  if (existingLead?.id) {
    leadId = existingLead.id;
  } else {
    const { data: createdLead, error } = await supabaseAdmin
      .from("leads")
      .insert({
        phone_e164: input.sender,
        lead_source: "ringcentral_sms",
        consent_status: "unknown",
        lifecycle: "New",
      })
      .select("id")
      .single();
    if (error || !createdLead) {
      throw new Error(error?.message ?? "Failed to create lead");
    }
    leadId = createdLead.id;
    await recordLeadEvent({
      leadId,
      eventType: "lead_created",
      actor: "ringcentral_webhook",
      summary: "Lead created from inbound SMS",
      toLifecycle: "New",
    });
  }

  let threadId: string;
  const { data: existingThread } = await supabaseAdmin
    .from("message_threads")
    .select("id")
    .eq("lead_id", leadId)
    .eq("phone_e164", input.sender)
    .maybeSingle();

  if (existingThread?.id) {
    threadId = existingThread.id;
  } else {
    const { data: createdThread, error } = await supabaseAdmin
      .from("message_threads")
      .insert({
        lead_id: leadId,
        phone_e164: input.sender,
        control_mode: "auto",
      })
      .select("id")
      .single();
    if (error || !createdThread) {
      throw new Error(error?.message ?? "Failed to create thread");
    }
    threadId = createdThread.id;
  }

  const { data: message, error: msgError } = await supabaseAdmin
    .from("messages")
    .insert({
      thread_id: threadId,
      lead_id: leadId,
      direction: "inbound",
      provider: "ringcentral",
      provider_message_id: input.providerMessageId,
      sender_e164: input.sender,
      recipients_e164: [input.ourNumber],
      body: input.bodyText,
      channel: input.channel,
      delivery_state: "received",
      provider_created_at: input.providerCreatedAt,
      provider_metadata_redacted: {
        provider_message_id: input.providerMessageId,
        channel: input.channel,
      },
    })
    .select("id")
    .maybeSingle();

  if (msgError) {
    if (msgError.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("messages")
        .select("id, lead_id, thread_id")
        .eq("provider", "ringcentral")
        .eq("provider_message_id", input.providerMessageId)
        .maybeSingle();
      if (raced?.id) {
        return {
          leadId: raced.lead_id,
          threadId: raced.thread_id,
          messageId: raced.id,
          created: false,
        };
      }
    }
    throw new Error(msgError.message);
  }

  if (!message?.id) {
    throw new Error("Failed to insert inbound message");
  }

  // Increment unread via read-modify (service role).
  const { data: leadRow } = await supabaseAdmin
    .from("leads")
    .select("unread_count")
    .eq("id", leadId)
    .single();
  await supabaseAdmin
    .from("leads")
    .update({
      unread_count: (leadRow?.unread_count ?? 0) + 1,
      last_message_at: new Date().toISOString(),
      last_inbound_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  const { data: threadRow } = await supabaseAdmin
    .from("message_threads")
    .select("unread_count")
    .eq("id", threadId)
    .single();
  await supabaseAdmin
    .from("message_threads")
    .update({
      unread_count: (threadRow?.unread_count ?? 0) + 1,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  return { leadId, threadId, messageId: message.id, created: true };
}

export async function processInboundJob(job: {
  id: string;
  inbound_provider_message_id: string | null;
  message_id: string | null;
  lead_id: string | null;
  thread_id: string | null;
}): Promise<void> {
  if (!job.message_id || !job.lead_id || !job.thread_id) {
    // Resolve from provider id if needed.
    if (!job.inbound_provider_message_id) {
      throw new Error("Inbound job missing identifiers");
    }
    const { data: msg } = await supabaseAdmin
      .from("messages")
      .select("id, lead_id, thread_id, body")
      .eq("provider", "ringcentral")
      .eq("provider_message_id", job.inbound_provider_message_id)
      .maybeSingle();
    if (!msg) throw new Error("Inbound message not found for job");
    job.message_id = msg.id;
    job.lead_id = msg.lead_id;
    job.thread_id = msg.thread_id;
  }

  // Parallel-run / duplicate protection via unique agent_runs(inbound_message_id)
  const { data: existingRun } = await supabaseAdmin
    .from("agent_runs")
    .select("id")
    .eq("inbound_message_id", job.message_id)
    .maybeSingle();
  if (existingRun?.id) {
    return;
  }

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("id", job.lead_id)
    .single();
  const { data: thread } = await supabaseAdmin
    .from("message_threads")
    .select("*")
    .eq("id", job.thread_id)
    .single();
  const { data: inbound } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("id", job.message_id)
    .single();

  if (!lead || !thread || !inbound) {
    throw new Error("Missing lead/thread/inbound for processing");
  }

  // Consent updates from STOP/START before agent.
  if (isOptOutMessage(inbound.body)) {
    await supabaseAdmin
      .from("leads")
      .update({
        consent_status: "opted_out",
        consent_updated_at: new Date().toISOString(),
        consent_evidence: {
          type: "sms_keyword",
          keyword: "STOP",
          at: new Date().toISOString(),
          message_id: inbound.id,
        },
      })
      .eq("id", lead.id);
    lead.consent_status = "opted_out";
    await recordLeadEvent({
      leadId: lead.id,
      eventType: "consent_opt_out",
      actor: "system",
      summary: "Customer opted out via SMS keyword",
    });
  } else if (isOptInMessage(inbound.body)) {
    await supabaseAdmin
      .from("leads")
      .update({
        consent_status: "opted_in",
        consent_updated_at: new Date().toISOString(),
        consent_evidence: {
          type: "sms_keyword",
          keyword: "START",
          at: new Date().toISOString(),
          message_id: inbound.id,
        },
      })
      .eq("id", lead.id);
    lead.consent_status = "opted_in";
    await recordLeadEvent({
      leadId: lead.id,
      eventType: "consent_opt_in",
      actor: "system",
      summary: "Customer opted in via SMS keyword",
    });
  }

  const { data: recent } = await supabaseAdmin
    .from("messages")
    .select("direction, body")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: false })
    .limit(8);

  const agentResult = await runLeadSmsAgent({
    lead: {
      id: lead.id,
      name: lead.name,
      phone_e164: lead.phone_e164,
      email: lead.email,
      vehicle_year: lead.vehicle_year,
      vehicle_make: lead.vehicle_make,
      vehicle_model: lead.vehicle_model,
      vehicle_mileage: lead.vehicle_mileage,
      vin: lead.vin,
      symptoms: lead.symptoms,
      lifecycle: lead.lifecycle as LeadLifecycle,
      consent_status: lead.consent_status,
      notes: lead.notes,
    },
    thread: {
      id: thread.id,
      control_mode: thread.control_mode,
    },
    inboundBody: inbound.body ?? "",
    recentMessages: (recent ?? []).reverse().map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
    })),
  });

  const decision = agentResult.decision;

  // Apply safe lead field updates (null means unknown / clear only when explicitly null in schema — we only set provided keys)
  if (decision.lead_field_updates) {
    const updates: {
      name?: string | null;
      email?: string | null;
      vehicle_year?: number | null;
      vehicle_make?: string | null;
      vehicle_model?: string | null;
      vehicle_mileage?: number | null;
      vin?: string | null;
      symptoms?: string | null;
      notes?: string | null;
    } = {};
    const src = decision.lead_field_updates;
    if (src.name !== undefined) updates.name = src.name;
    if (src.email !== undefined) updates.email = src.email;
    if (src.vehicle_year !== undefined) updates.vehicle_year = src.vehicle_year;
    if (src.vehicle_make !== undefined) updates.vehicle_make = src.vehicle_make;
    if (src.vehicle_model !== undefined) updates.vehicle_model = src.vehicle_model;
    if (src.vehicle_mileage !== undefined) updates.vehicle_mileage = src.vehicle_mileage;
    if (src.vin !== undefined) updates.vin = src.vin;
    if (src.symptoms !== undefined) updates.symptoms = src.symptoms;
    if (src.notes !== undefined) updates.notes = src.notes;
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from("leads").update(updates).eq("id", lead.id);
    }
  }

  let outboundMessageId: string | null = null;
  let escalationId: string | null = null;

  if (decision.action === "escalate") {
    await supabaseAdmin
      .from("message_threads")
      .update({ control_mode: "human" })
      .eq("id", thread.id);

    const { data: esc } = await supabaseAdmin
      .from("escalations")
      .insert({
        lead_id: lead.id,
        thread_id: thread.id,
        category: decision.escalation_category!,
        reason: decision.audit_summary,
        status: "open",
      })
      .select("id")
      .single();
    escalationId = esc?.id ?? null;

    await recordLeadEvent({
      leadId: lead.id,
      eventType: "escalated",
      actor: "grok_agent",
      summary: decision.audit_summary,
      metadata: { category: decision.escalation_category },
    });
  }

  if (decision.action === "send" && decision.message) {
    // Final consent gate
    const { data: freshLead } = await supabaseAdmin
      .from("leads")
      .select("consent_status")
      .eq("id", lead.id)
      .single();
    if (freshLead?.consent_status === "opted_out") {
      // do not send
    } else {
      const sent = await sendOutboundSms({
        leadId: lead.id,
        threadId: thread.id,
        toE164: lead.phone_e164!,
        body: decision.message,
        actor: "grok_agent",
        idempotencyKey: `agent-reply:${inbound.id}`,
      });
      outboundMessageId = sent.messageId;
    }
  }

  if (
    decision.proposed_lifecycle &&
    decision.action !== "escalate" &&
    decision.proposed_lifecycle !== "Contacted"
  ) {
    // Contacted is owned by successful outbound accept only.
    await transitionLeadLifecycle({
      leadId: lead.id,
      to: decision.proposed_lifecycle,
      actor: "grok_agent",
      summary: decision.audit_summary,
    });
  }

  const rawDecision = {
    action: decision.action,
    message: decision.message,
    lead_field_updates: decision.lead_field_updates,
    proposed_lifecycle: decision.proposed_lifecycle,
    tags: decision.tags,
    escalation_category: decision.escalation_category,
    audit_summary: decision.audit_summary,
  };

  const { error: runError } = await supabaseAdmin.from("agent_runs").insert({
    lead_id: lead.id,
    thread_id: thread.id,
    inbound_message_id: inbound.id,
    outbound_message_id: outboundMessageId,
    prompt_version: agentResult.promptVersion,
    model: agentResult.model,
    action: decision.action,
    policy_tags: decision.tags,
    audit_summary: decision.audit_summary,
    proposed_lifecycle: decision.proposed_lifecycle,
    lead_field_updates: decision.lead_field_updates,
    escalation_category: decision.escalation_category,
    raw_decision: rawDecision,
  });

  if (runError) {
    if (runError.code === "23505") {
      return; // parallel run lost the race — safe
    }
    throw new Error(runError.message);
  }

  if (escalationId) {
    await supabaseAdmin
      .from("escalations")
      .update({/* agent_run linked after insert via inbound uniqueness path */})
      .eq("id", escalationId);
  }
}

export async function reconcileMessageStore(hoursBack = 6): Promise<{
  examined: number;
  enqueued: number;
}> {
  const { listMessageStore } = await import("@/integrations/ringcentral/client.server");
  const dateFrom = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
  const records = await listMessageStore({ dateFrom, messageType: "SMS", perPage: 100 });
  let enqueued = 0;

  for (const record of records) {
    if (!record.id) continue;
    if (String(record.direction).toLowerCase() !== "inbound") continue;

    const { data: existing } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("provider", "ringcentral")
      .eq("provider_message_id", String(record.id))
      .maybeSingle();

    if (existing?.id) continue;

    const result = await ingestRingCentralWebhook({
      body: {
        id: record.id,
        type: record.type ?? "SMS",
        ...(record.subject != null ? { subject: record.subject } : {}),
        direction: record.direction,
        ...(record.from ? { from: record.from } : {}),
        ...(record.to ? { to: record.to } : {}),
        ...(record.creationTime != null ? { creationTime: record.creationTime } : {}),
        ...(record.lastModifiedTime != null ? { lastModifiedTime: record.lastModifiedTime } : {}),
        ...(record.messageStatus != null ? { messageStatus: record.messageStatus } : {}),
      },
    });
    if (result.jobId && !result.duplicate && !result.ignored) enqueued += 1;
  }

  return { examined: records.length, enqueued };
}

export async function renewDueSubscriptions(): Promise<{
  renewed: number;
  failed: number;
  errors: string[];
}> {
  const { renewSubscription } = await import("@/integrations/ringcentral/client.server");
  const horizon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { data: subs } = await supabaseAdmin
    .from("ringcentral_subscriptions")
    .select("*")
    .or(`expires_at.is.null,expires_at.lte.${horizon}`);

  let renewed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const sub of subs ?? []) {
    try {
      const result = await renewSubscription(sub.provider_subscription_id);
      await supabaseAdmin
        .from("ringcentral_subscriptions")
        .update({
          status: result.status,
          expires_at: result.expiresAt,
          last_renewed_at: new Date().toISOString(),
          last_renewal_error: null,
        })
        .eq("id", sub.id);
      renewed += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : "renew failed";
      errors.push(msg);
      await supabaseAdmin
        .from("ringcentral_subscriptions")
        .update({ last_renewal_error: msg.slice(0, 500) })
        .eq("id", sub.id);
    }
  }

  // Touch capability check without logging secrets.
  try {
    await resolveFromNumberCapability();
  } catch {
    // recorded via health endpoint separately
  }

  return { renewed, failed, errors };
}
