// Bounded, idempotent job processing for the lead inbox.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GrokDeniedError, PROMPT_VERSION, decideReply } from "./grok.server";
import { sendOutbound } from "./outbound.server";
import { OPT_OUT_CONFIRMATION, detectEscalation } from "./safety.server";
import { applyLifecycleTransition } from "./lifecycle.server";
import {
  OPT_OUT_NOT_APPLIED_REASON,
  PROCESS_BUDGET_MS,
  STALE_INBOUND_REASON,
  STALE_OPT_OUT_REASON,
  XAI_DECISION_TIMEOUT_MS,
  errorText,
  inboundReceivedAt,
  planInboundHandling,
  replyTextFromAgentRaw,
  reserveForJob,
  shouldWriteOptOut,
} from "./job-lease";
import {
  addEvent,
  claimJobs,
  completeJob,
  failJob,
  findMessageByProviderId,
  getOrCreateLeadThread,
  openEscalation,
  recordHealth,
  recordInboundMessage,
  releaseClaimedJob,
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
  succeeded: number;
  failed: number;
  paused: boolean;
  pauseDetail: string | null;
};

export async function processJobs(
  limit = BATCH_SIZE,
  options?: { budgetMs?: number },
): Promise<ProcessSummary> {
  const circuit = await agentCircuitState();
  const summary: ProcessSummary = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    paused: circuit.paused,
    pauseDetail: circuit.detail,
  };

  // Paused: allow a single probe item per run to detect out-of-band recovery.
  const effectiveLimit = circuit.paused ? 1 : limit;
  const deadline = Date.now() + (options?.budgetMs ?? PROCESS_BUDGET_MS);

  // Claim one at a time. A batch claimed up front used to stay processing when
  // the isolate was killed during a later xAI call.
  while (summary.claimed < effectiveLimit) {
    const [job] = await claimJobs(1);
    if (!job) break;
    if (deadline - Date.now() < reserveForJob(job, new Date())) {
      await releaseClaimedJob(job);
      break;
    }
    summary.claimed += 1;
    try {
      await runJob(job, deadline);
      if (!job.locked_at) throw new Error("Claimed job is missing its lease");
      const finished = await completeJob(job.id, job.locked_at);
      if (!finished) continue;
      summary.succeeded += 1;
      if (circuit.paused) {
        await resumeAgent("Probe succeeded; agent resumed automatically");
        summary.paused = false;
        break;
      }
    } catch (error) {
      const message = errorText(error);
      if (
        error instanceof GrokDeniedError &&
        !error.retryable &&
        (error.status === 402 || error.status === 403)
      ) {
        await pauseAgent(message);
        summary.paused = true;
        summary.pauseDetail = message;
        await failJob(job, message);
        summary.failed += 1;
        break;
      }
      await failJob(job, message);
      summary.failed += 1;
    }
  }

  return summary;
}

async function runJob(job: JobRow, deadlineMs: number): Promise<void> {
  switch (job.job_type) {
    case "process_inbound":
      return processInbound(job, deadlineMs);
    case "send_outbound":
      return processSendOutbound(job);
    case "process_meta_lead": {
      const { processMetaLead } = await import("@/server/meta-leads/first-touch.server");
      return processMetaLead(job);
    }
    default:
      // reconcile / renew_subscription are driven by their own cron routes.
      // Leave them pending-equivalent by failing the claim so a no-op cannot
      // be marked succeeded.
      throw new Error(`Unsupported job type ${job.job_type}`);
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

export async function processInbound(
  job: JobRow,
  deadlineMs = Date.now() + PROCESS_BUDGET_MS,
): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as InboundPayload;
  if (!payload.provider_message_id || !payload.from) {
    throw new Error("Inbound job payload missing provider_message_id/from");
  }

  const body = payload.body ?? "";
  const providerCreatedAt = payload.provider_created_at ?? null;
  const { lead, thread } = await getOrCreateLeadThread(payload.from, "RingCentral SMS");
  const inserted = await recordInboundMessage({
    leadId: lead.id,
    threadId: thread.id,
    providerMessageId: payload.provider_message_id,
    body,
    senderE164: toE164(payload.from),
    recipients: (payload.to ?? []).map(toE164),
    providerCreatedAt,
    channel: payload.channel === "MMS" ? "MMS" : "SMS",
    ...(payload.attachment_urls ? { attachmentUrls: payload.attachment_urls } : {}),
  });
  // A previous attempt may have stored the message and then died. Keep going
  // so opt-out still applies. planInboundHandling refuses automated texts
  // once the inbound is outside the window.
  const message = inserted ?? (await findMessageByProviderId(payload.provider_message_id));
  if (!message) throw new Error("Inbound message was not stored");

  const handling = planInboundHandling({
    body,
    providerCreatedAt,
    jobCreatedAt: job.created_at,
    now: new Date(),
    consentStatus: lead.consent_status,
  });

  if (handling.applyOptOut) {
    const inboundAtMs = inboundReceivedAt(providerCreatedAt, job.created_at);
    if (
      shouldWriteOptOut({
        consentStatus: lead.consent_status,
        consentUpdatedAt: lead.consent_updated_at,
        inboundAtMs,
      })
    ) {
      const { error } = await supabaseAdmin
        .from("leads")
        .update({
          consent_status: "opted_out",
          consent_updated_at: new Date().toISOString(),
          consent_evidence: { source: "sms_keyword", message_id: message.id } as never,
        })
        .eq("id", lead.id);
      if (error) throw error;
      await addEvent(lead.id, "opted_out", "Customer texted an opt-out keyword", "system");
    } else if (lead.consent_status !== "opted_out") {
      await addEvent(lead.id, "opt_out_not_applied", OPT_OUT_NOT_APPLIED_REASON, "system");
    }
    if (handling.sendOptOutConfirmation) {
      await sendOutbound({
        leadId: lead.id,
        threadId: thread.id,
        to: payload.from,
        text: OPT_OUT_CONFIRMATION,
        idempotencyKey: `optout:${message.id}`,
        actor: "system",
      });
    } else {
      await surfaceStaleInbound(lead.id, thread.id, STALE_OPT_OUT_REASON);
    }
    return;
  }

  if (handling.applyOptIn) {
    const { error } = await supabaseAdmin
      .from("leads")
      .update({
        consent_status: "opted_in",
        consent_updated_at: new Date().toISOString(),
        consent_evidence: { source: "sms_keyword", message_id: message.id } as never,
      })
      .eq("id", lead.id);
    if (error) throw error;
    await addEvent(lead.id, "opted_in", "Customer texted an opt-in keyword", "system");
  }

  if (!handling.autoReply) {
    if (handling.surfaceForHuman) {
      await surfaceStaleInbound(lead.id, thread.id, STALE_INBOUND_REASON);
    } else {
      await addEvent(
        lead.id,
        "reply_suppressed",
        "Lead is opted out; no automated reply sent",
        "system",
      );
    }
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

  const prior = await existingAgentRun(message.id);
  if (prior) {
    if (prior.action === "send") {
      const text = replyTextFromAgentRaw(prior.raw_decision);
      if (text) {
        await sendAgentReply({
          leadId: lead.id,
          threadId: thread.id,
          to: payload.from,
          text,
          messageId: message.id,
          agentRunId: prior.id,
        });
      }
    }
    return;
  }

  const history = await threadHistory(thread.id, 20);
  const timeoutMs = Math.max(
    1_000,
    Math.min(XAI_DECISION_TIMEOUT_MS, deadlineMs - Date.now() - 3_000),
  );
  const { decision, model, raw } = await decideReply(
    { lead, history, inboundBody: body },
    timeoutMs,
  );

  const { data: run, error: runError } = await supabaseAdmin
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
  if (runError) {
    if ((runError as { code?: string }).code !== "23505") throw runError;
    const raced = await existingAgentRun(message.id);
    if (raced?.action === "send") {
      const text = replyTextFromAgentRaw(raced.raw_decision);
      if (text) {
        await sendAgentReply({
          leadId: lead.id,
          threadId: thread.id,
          to: payload.from,
          text,
          messageId: message.id,
          agentRunId: raced.id,
        });
      }
    }
    return;
  }

  await recordHealth({
    provider: "xai",
    checkName: "agent_decision",
    ok: true,
    detail: decision.action,
  });

  if (decision.lead_field_updates && Object.keys(decision.lead_field_updates).length > 0) {
    const updates = sanitizeLeadUpdates(decision.lead_field_updates);
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin
        .from("leads")
        .update(updates as never)
        .eq("id", lead.id);
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
      await addEvent(lead.id, "lifecycle_transition_rejected", transition.reason, "grok", {
        proposed_to: decision.proposed_lifecycle,
        from_lifecycle: lead.lifecycle,
        agent_run_id: run?.id ?? null,
        inbound_message_id: message.id,
        code: transition.code,
      });
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
    await sendAgentReply({
      leadId: lead.id,
      threadId: thread.id,
      to: payload.from,
      text: decision.reply_text,
      messageId: message.id,
      agentRunId: run?.id ?? null,
    });
  }
}

async function surfaceStaleInbound(
  leadId: string,
  threadId: string,
  reason: string,
): Promise<void> {
  await addEvent(leadId, "reply_suppressed", reason.slice(0, 300), "system");
  await openEscalation({
    leadId,
    threadId,
    category: "stale_inbound",
    reason,
    takeThreadControl: false,
  });
}

async function existingAgentRun(messageId: string): Promise<{
  id: string;
  action: string;
  raw_decision: unknown;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("agent_runs")
    .select("id, action, raw_decision")
    .eq("inbound_message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function sendAgentReply(args: {
  leadId: string;
  threadId: string;
  to: string;
  text: string;
  messageId: string;
  agentRunId: string | null;
}): Promise<void> {
  const outcome = await sendOutbound({
    leadId: args.leadId,
    threadId: args.threadId,
    to: args.to,
    text: args.text,
    idempotencyKey: `agent:${args.messageId}`,
    actor: "grok",
  });
  if (!outcome.ok) {
    await openEscalation({
      leadId: args.leadId,
      threadId: args.threadId,
      category: "other_high_risk",
      reason: `Automated reply could not be sent: ${outcome.reason}`,
      agentRunId: args.agentRunId,
    });
  }
}

export function sanitizeLeadUpdates(updates: Record<string, unknown>): Record<string, unknown> {
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
