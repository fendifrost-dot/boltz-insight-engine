// Bounded, idempotent job processing for the lead inbox.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GrokDeniedError, PROMPT_VERSION, decideReply } from "./grok.server";
import { sendOutbound } from "./outbound.server";
import {
  OPT_OUT_CONFIRMATION,
  detectEscalation,
  detectOptIn,
  detectOptOut,
} from "./safety.server";
import { applyLifecycleTransition } from "./lifecycle.server";
import {
  addEvent,
  claimJobs,
  completeJob,
  failJob,
  getOrCreateLeadThread,
  openEscalation,
  recordHealth,
  recordInboundMessage,
  threadHistory,
  toE164,
} from "./store.server";
import type { JobRow } from "./store.server";

export const BATCH_SIZE = 10;

/** Circuit breaker state lives in the database so every entry point sees it. */
export async function agentCircuitState(): Promise<{ paused: boolean; detail: string | null }> {
  const { data } = await supabaseAdmin
    .from("integration_health_snapshots")
    .select("ok, detail")
    .eq("provider", "xai")
    .eq("check_name", "agent_circuit")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { paused: false, detail: null };
  return { paused: !data.ok, detail: data.detail };
}

async function pauseAgent(detail: string): Promise<void> {
  await recordHealth({ provider: "xai", checkName: "agent_circuit", ok: false, detail });
}

export async function resumeAgent(detail = "Resumed by owner"): Promise<void> {
  await recordHealth({ provider: "xai", checkName: "agent_circuit", ok: true, detail });
}

export type ProcessSummary = {
  claimed: number;
  recoveredStale: number;
  succeeded: number;
  failed: number;
  paused: boolean;
  pauseDetail: string | null;
};

export async function processJobs(limit = BATCH_SIZE): Promise<ProcessSummary> {
  const circuit = await agentCircuitState();
  const summary: ProcessSummary = {
    claimed: 0,
    recoveredStale: 0,
    succeeded: 0,
    failed: 0,
    paused: circuit.paused,
    pauseDetail: circuit.detail,
  };

  // Paused: allow a single probe item per run to detect out-of-band recovery.
  const effectiveLimit = circuit.paused ? 1 : limit;
  const { jobs, recovered } = await claimJobs(effectiveLimit);
  summary.claimed = jobs.length;
  summary.recoveredStale = recovered;

  for (const job of jobs) {
    try {
      await runJob(job);
      await completeJob(job.id);
      summary.succeeded += 1;
      if (circuit.paused) {
        await resumeAgent("Probe succeeded; agent resumed automatically");
        summary.paused = false;
      }
    } catch (error) {
      if (error instanceof GrokDeniedError && !error.retryable && (error.status === 402 || error.status === 403)) {
        await pauseAgent(error.message);
        summary.paused = true;
        summary.pauseDetail = error.message;
        await failJob(job, error.message);
        summary.failed += 1;
        break;
      }
      await failJob(job, error instanceof Error ? error.message : String(error));
      summary.failed += 1;
    }
  }

  return summary;
}

async function runJob(job: JobRow): Promise<void> {
  switch (job.job_type) {
    case "process_inbound":
      return processInbound(job);
    case "send_outbound":
      return processSendOutbound(job);
    default:
      // reconcile / renew_subscription are driven by their own cron routes.
      return;
  }
}

type InboundPayload = {
  provider_message_id: string;
  body: string;
  from: string;
  to: string[];
  provider_created_at: string | null;
  channel?: "SMS" | "MMS";
  attachment_urls?: string[];
};

export async function processInbound(job: JobRow): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as InboundPayload;
  if (!payload.provider_message_id || !payload.from) {
    throw new Error("Inbound job payload missing provider_message_id/from");
  }

  const { lead, thread } = await getOrCreateLeadThread(payload.from, "RingCentral SMS");
  const message = await recordInboundMessage({
    leadId: lead.id,
    threadId: thread.id,
    providerMessageId: payload.provider_message_id,
    body: payload.body ?? "",
    senderE164: toE164(payload.from),
    recipients: (payload.to ?? []).map(toE164),
    providerCreatedAt: payload.provider_created_at ?? null,
    channel: payload.channel === "MMS" ? "MMS" : "SMS",
    ...(payload.attachment_urls ? { attachmentUrls: payload.attachment_urls } : {}),
  });

  if (!message) return; // already processed

  const body = payload.body ?? "";

  if (detectOptOut(body)) {
    await supabaseAdmin
      .from("leads")
      .update({
        consent_status: "opted_out",
        consent_updated_at: new Date().toISOString(),
        consent_evidence: { source: "sms_keyword", message_id: message.id } as never,
      })
      .eq("id", lead.id);
    await addEvent(lead.id, "opted_out", "Customer texted an opt-out keyword", "system");
    await sendOutbound({
      leadId: lead.id,
      threadId: thread.id,
      to: payload.from,
      text: OPT_OUT_CONFIRMATION,
      idempotencyKey: `optout:${message.id}`,
      actor: "system",
    });
    return;
  }

  if (detectOptIn(body)) {
    await supabaseAdmin
      .from("leads")
      .update({
        consent_status: "opted_in",
        consent_updated_at: new Date().toISOString(),
        consent_evidence: { source: "sms_keyword", message_id: message.id } as never,
      })
      .eq("id", lead.id);
    await addEvent(lead.id, "opted_in", "Customer texted an opt-in keyword", "system");
  }

  if (lead.consent_status === "opted_out" && !detectOptIn(body)) {
    await addEvent(lead.id, "reply_suppressed", "Lead is opted out; no automated reply sent", "system");
    return;
  }

  const rule = detectEscalation(body);
  if (rule) {
    await openEscalation({
      leadId: lead.id,
      threadId: thread.id,
      category: rule.category,
      reason: rule.reason,
    });
    return;
  }

  const { data: freshThread } = await supabaseAdmin
    .from("message_threads")
    .select("control_mode")
    .eq("id", thread.id)
    .maybeSingle();
  if (freshThread?.control_mode === "human") {
    await addEvent(lead.id, "reply_suppressed", "Thread is under human control", "system");
    return;
  }

  const history = await threadHistory(thread.id, 20);
  const { decision, model, raw } = await decideReply({ lead, history, inboundBody: body });

  const { data: run } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      lead_id: lead.id,
      thread_id: thread.id,
      inbound_message_id: message.id,
      action: decision.action,
      model,
      prompt_version: PROMPT_VERSION,
      audit_summary: decision.audit_summary,
      escalation_category: decision.escalation_category,
      proposed_lifecycle: decision.proposed_lifecycle,
      lead_field_updates: (decision.lead_field_updates ?? null) as never,
      policy_tags: decision.policy_tags,
      raw_decision: raw as never,
    })
    .select("id")
    .single();

  await recordHealth({ provider: "xai", checkName: "agent_decision", ok: true, detail: decision.action });

  if (decision.lead_field_updates && Object.keys(decision.lead_field_updates).length > 0) {
    const updates = sanitizeLeadUpdates(decision.lead_field_updates);
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from("leads").update(updates as never).eq("id", lead.id);
      await addEvent(lead.id, "lead_fields_updated", "Agent updated lead details", "grok", updates);
    }
  }

  if (decision.proposed_lifecycle && decision.proposed_lifecycle !== lead.lifecycle) {
    const transition = await applyLifecycleTransition({
      leadId: lead.id,
      fromLifecycle: lead.lifecycle,
      toLifecycle: decision.proposed_lifecycle,
      actor: "grok",
      evidence: {
        basis: "agent_decision",
        agentRunId: run?.id,
        inboundMessageId: message.id,
        note: decision.audit_summary,
      },
      summary: `Agent proposed lifecycle move to ${decision.proposed_lifecycle}`,
    });
    if (!transition.ok) {
      await addEvent(
        lead.id,
        "lifecycle_transition_rejected",
        transition.reason,
        "grok",
        {
          proposed_to: decision.proposed_lifecycle,
          from_lifecycle: lead.lifecycle,
          agent_run_id: run?.id ?? null,
          inbound_message_id: message.id,
          code: transition.code,
        },
      );
    }
  }

  if (decision.action === "escalate") {
    await openEscalation({
      leadId: lead.id,
      threadId: thread.id,
      category: decision.escalation_category ?? "other_high_risk",
      reason: decision.audit_summary || "Agent requested human review",
      agentRunId: run?.id ?? null,
    });
    return;
  }

  if (decision.action === "send" && decision.reply_text) {
    const outcome = await sendOutbound({
      leadId: lead.id,
      threadId: thread.id,
      to: payload.from,
      text: decision.reply_text,
      idempotencyKey: `agent:${message.id}`,
      actor: "grok",
    });
    if (!outcome.ok) {
      await openEscalation({
        leadId: lead.id,
        threadId: thread.id,
        category: "other_high_risk",
        reason: `Automated reply could not be sent: ${outcome.reason}`,
        agentRunId: run?.id ?? null,
      });
    }
  }
}

function sanitizeLeadUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "name",
    "email",
    "vehicle_year",
    "vehicle_make",
    "vehicle_model",
    "vehicle_mileage",
    "vin",
    "symptoms",
    "notes",
  ];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = updates[key];
    if (value === null || value === undefined || value === "") continue;
    out[key] = typeof value === "string" ? value.slice(0, 2000) : value;
  }
  return out;
}

type OutboundPayload = { to: string; text: string; actor?: string };

async function processSendOutbound(job: JobRow): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as OutboundPayload;
  if (!job.lead_id || !job.thread_id || !payload.to || !payload.text) {
    throw new Error("send_outbound job missing lead/thread/to/text");
  }
  const outcome = await sendOutbound({
    leadId: job.lead_id,
    threadId: job.thread_id,
    to: payload.to,
    text: payload.text,
    idempotencyKey: `job:${job.id}`,
    actor: payload.actor ?? "system",
  });
  if (!outcome.ok) throw new Error(outcome.reason);
}
