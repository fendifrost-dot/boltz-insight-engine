// Supabase persistence for the lead inbox (service role, server-only).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type LeadRow = Tables["leads"]["Row"];
export type ThreadRow = Tables["message_threads"]["Row"];
export type MessageRow = Tables["messages"]["Row"];
export type JobRow = Tables["message_jobs"]["Row"];
export type JobType = Database["public"]["Enums"]["message_job_type"];

export function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function getOrCreateLeadThread(
  phoneRaw: string,
  leadSource: string,
): Promise<{ lead: LeadRow; thread: ThreadRow }> {
  const phone = toE164(phoneRaw);

  const { data: existingThread, error: threadError } = await supabaseAdmin
    .from("message_threads")
    .select("*")
    .eq("phone_e164", phone)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (threadError) throw threadError;

  if (existingThread) {
    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", existingThread.lead_id)
      .single();
    if (error) throw error;
    return { lead, thread: existingThread };
  }

  const { data: existingLead, error: leadLookupError } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("phone_e164", phone)
    .maybeSingle();
  if (leadLookupError) throw leadLookupError;

  let lead = existingLead;
  if (!lead) {
    const { data: created, error } = await supabaseAdmin
      .from("leads")
      .insert({ phone_e164: phone, lead_source: leadSource, lifecycle: "New" })
      .select("*")
      .single();
    if (error) throw error;
    lead = created;
    await addEvent(lead.id, "lead_created", `Lead created from ${leadSource}`, "system");
  }

  const { data: thread, error: threadInsertError } = await supabaseAdmin
    .from("message_threads")
    .insert({ lead_id: lead.id, phone_e164: phone, control_mode: "auto" })
    .select("*")
    .single();
  if (threadInsertError) throw threadInsertError;

  return { lead, thread };
}

export async function addEvent(
  leadId: string,
  eventType: string,
  summary: string,
  actor: string,
  metadata?: Record<string, unknown>,
  lifecycle?: { from: LeadRow["lifecycle"] | null; to: LeadRow["lifecycle"] | null },
): Promise<void> {
  const { error } = await supabaseAdmin.from("lead_events").insert({
    lead_id: leadId,
    event_type: eventType,
    summary,
    actor,
    metadata: (metadata ?? null) as never,
    from_lifecycle: lifecycle?.from ?? null,
    to_lifecycle: lifecycle?.to ?? null,
  });
  if (error) throw error;
}

export async function findMessageByProviderId(providerMessageId: string): Promise<MessageRow | null> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function recordInboundMessage(args: {
  leadId: string;
  threadId: string;
  providerMessageId: string;
  body: string;
  senderE164: string;
  recipients: string[];
  providerCreatedAt: string | null;
  channel: Database["public"]["Enums"]["message_channel"];
  attachmentUrls?: string[];
  metadata?: Record<string, unknown>;
}): Promise<MessageRow | null> {
  const existing = await findMessageByProviderId(args.providerMessageId);
  if (existing) return null;

  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      lead_id: args.leadId,
      thread_id: args.threadId,
      direction: "inbound",
      channel: args.channel,
      body: args.body,
      provider: "ringcentral",
      provider_message_id: args.providerMessageId,
      provider_created_at: args.providerCreatedAt,
      sender_e164: args.senderE164,
      recipients_e164: args.recipients,
      delivery_state: "received",
      attachment_urls: (args.attachmentUrls ?? null) as never,
      provider_metadata_redacted: (args.metadata ?? null) as never,
    })
    .select("*")
    .single();
  if (error) {
    // Unique-violation racing another worker means the message already landed.
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("leads")
    .update({ last_inbound_at: now, last_message_at: now })
    .eq("id", args.leadId);
  await supabaseAdmin
    .from("message_threads")
    .update({ last_message_at: now })
    .eq("id", args.threadId);

  return data;
}

export async function recordOutboundMessage(args: {
  leadId: string;
  threadId: string;
  body: string;
  recipient: string;
  sender: string;
  idempotencyKey: string;
  deliveryState: Database["public"]["Enums"]["message_delivery_state"];
  providerMessageId: string | null;
  providerCreatedAt: string | null;
  metadata?: Record<string, unknown>;
}): Promise<MessageRow | null> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return null;

  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      lead_id: args.leadId,
      thread_id: args.threadId,
      direction: "outbound",
      channel: "SMS",
      body: args.body,
      provider: "ringcentral",
      provider_message_id: args.providerMessageId,
      provider_created_at: args.providerCreatedAt,
      sender_e164: args.sender,
      recipients_e164: [args.recipient],
      idempotency_key: args.idempotencyKey,
      delivery_state: args.deliveryState,
      provider_metadata_redacted: (args.metadata ?? null) as never,
    })
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("leads")
    .update({ last_outbound_at: now, last_message_at: now })
    .eq("id", args.leadId);
  await supabaseAdmin.from("message_threads").update({ last_message_at: now }).eq("id", args.threadId);

  return data;
}

export async function enqueueJob(args: {
  jobType: JobType;
  leadId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  inboundProviderMessageId?: string | null;
  payload?: Record<string, unknown>;
  runAfter?: string;
}): Promise<JobRow | null> {
  if (args.inboundProviderMessageId) {
    const { data: dupe, error } = await supabaseAdmin
      .from("message_jobs")
      .select("*")
      .eq("job_type", args.jobType)
      .eq("inbound_provider_message_id", args.inboundProviderMessageId)
      .maybeSingle();
    if (error) throw error;
    if (dupe) return null;
  }

  const { data, error } = await supabaseAdmin
    .from("message_jobs")
    .insert({
      job_type: args.jobType,
      lead_id: args.leadId ?? null,
      thread_id: args.threadId ?? null,
      message_id: args.messageId ?? null,
      inbound_provider_message_id: args.inboundProviderMessageId ?? null,
      payload: (args.payload ?? null) as never,
      run_after: args.runAfter ?? new Date().toISOString(),
      status: "pending",
    })
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
  return data;
}

/** Default lease for message job processing (2 minutes). */
export const DEFAULT_JOB_LEASE_MS = 120_000;

type ClaimJobsResult = {
  jobs: JobRow[];
  recovered: number;
};

/** Bounded claim with stale-lease recovery and row-level locking. */
export async function claimJobs(
  limit: number,
  leaseMs = DEFAULT_JOB_LEASE_MS,
): Promise<ClaimJobsResult> {
  const { data, error } = await supabaseAdmin.rpc("claim_message_jobs", {
    _limit: limit,
    _lease_ms: leaseMs,
  });
  if (error) throw error;

  const payload = data as { recovered?: number; jobs?: JobRow[] } | null;
  return {
    jobs: payload?.jobs ?? [],
    recovered: payload?.recovered ?? 0,
  };
}

export async function completeJob(id: string): Promise<void> {
  await supabaseAdmin
    .from("message_jobs")
    .update({ status: "succeeded", completed_at: new Date().toISOString(), locked_at: null, last_error: null })
    .eq("id", id);
}

export async function failJob(job: JobRow, message: string): Promise<void> {
  const dead = job.attempts >= job.max_attempts;
  const backoffMs = Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, job.attempts - 1));
  await supabaseAdmin
    .from("message_jobs")
    .update({
      status: dead ? "dead" : "pending",
      last_error: message.slice(0, 600),
      locked_at: null,
      run_after: new Date(Date.now() + backoffMs).toISOString(),
      completed_at: dead ? new Date().toISOString() : null,
    })
    .eq("id", job.id);
}

export async function recordHealth(args: {
  provider: string;
  checkName: string;
  ok: boolean;
  detail?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await supabaseAdmin.from("integration_health_snapshots").insert({
    provider: args.provider,
    check_name: args.checkName,
    ok: args.ok,
    detail: args.detail?.slice(0, 600) ?? null,
    metadata_redacted: (args.metadata ?? null) as never,
  });
}

export async function openEscalation(args: {
  leadId: string;
  threadId: string;
  category: Database["public"]["Enums"]["escalation_category"];
  reason: string;
  agentRunId?: string | null;
}): Promise<void> {
  const { data: open, error } = await supabaseAdmin
    .from("escalations")
    .select("id")
    .eq("thread_id", args.threadId)
    .in("status", ["open", "acknowledged"])
    .maybeSingle();
  if (error) throw error;

  if (!open) {
    const { error: insertError } = await supabaseAdmin.from("escalations").insert({
      lead_id: args.leadId,
      thread_id: args.threadId,
      category: args.category,
      reason: args.reason.slice(0, 600),
      agent_run_id: args.agentRunId ?? null,
      status: "open",
    });
    if (insertError) throw insertError;
  }

  await supabaseAdmin.from("message_threads").update({ control_mode: "human" }).eq("id", args.threadId);
  await addEvent(args.leadId, "escalated", args.reason.slice(0, 300), "system", {
    category: args.category,
  });
}

export async function threadHistory(threadId: string, limit = 20): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}
