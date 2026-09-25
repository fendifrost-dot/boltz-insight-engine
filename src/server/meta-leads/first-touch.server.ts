// `process_meta_lead` job: Grok first-touch for an ingested Meta lead.
// Runs from the shared job queue, so it inherits batch limits, retries and the
// xAI circuit breaker. Ingestion never waits on this step.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { META_FIRST_TOUCH_PROMPT_VERSION, decideFirstTouch } from "@/server/lead-inbox/grok.server";
import { sanitizeLeadUpdates } from "@/server/lead-inbox/jobs.server";
import { sendOutbound } from "@/server/lead-inbox/outbound.server";
import { detectEscalation } from "@/server/lead-inbox/safety.server";
import { addEvent, openEscalation, recordHealth } from "@/server/lead-inbox/store.server";
import type { JobRow } from "@/server/lead-inbox/store.server";
import { autoFirstTouchEnabled } from "./env.server";
import { META_LEAD_SOURCE, formSummary, resolvePlatform } from "./normalize";
import type { NormalizedMetaLead } from "./normalize";

type Payload = { meta_lead_id?: string };

export async function processMetaLead(job: JobRow): Promise<void> {
  const metaLeadId = ((job.payload ?? {}) as Payload).meta_lead_id;
  if (!metaLeadId) throw new Error("process_meta_lead payload missing meta_lead_id");

  const { data: submission, error } = await supabaseAdmin
    .from("meta_lead_submissions")
    .select("*")
    .eq("meta_lead_id", metaLeadId)
    .maybeSingle();
  if (error) throw error;
  if (!submission || submission.ingest_status !== "ingested" || !submission.lead_id) {
    throw new Error(`Meta lead ${metaLeadId} is not durably ingested yet`);
  }

  // Retried job after a successful Grok call: never decide (or send) twice.
  const { data: priorRun } = await supabaseAdmin
    .from("agent_runs")
    .select("id")
    .eq("lead_id", submission.lead_id)
    .eq("prompt_version", META_FIRST_TOUCH_PROMPT_VERSION)
    .eq("raw_decision->>meta_lead_id", metaLeadId)
    .limit(1)
    .maybeSingle();
  if (priorRun) return;

  const { data: lead, error: leadError } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("id", submission.lead_id)
    .single();
  if (leadError) throw leadError;

  const skip = (reason: string) =>
    addEvent(lead.id, "meta_first_touch_skipped", reason, "system", { meta_lead_id: metaLeadId });

  if (!lead.phone_e164)
    return skip("No usable phone number on the form; no SMS first touch possible");
  if (lead.consent_status === "opted_out") return skip("Lead is opted out; no first touch");
  // An existing SMS conversation is already handled by the inbound pipeline.
  if (lead.last_message_at)
    return skip("Lead already has an SMS conversation; first touch not drafted");

  const { data: thread } = await supabaseAdmin
    .from("message_threads")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!thread) return skip("No SMS thread for this lead");
  if (thread.control_mode === "human") return skip("Thread is under human control");

  const normalized = (submission.normalized_fields ?? null) as unknown as NormalizedMetaLead | null;
  const summary = normalized
    ? formSummary(normalized, submission.form_name)
    : `Meta Instant Form submission ${metaLeadId}`;

  const rule = detectEscalation(summary);
  if (rule) {
    await openEscalation({
      leadId: lead.id,
      threadId: thread.id,
      category: rule.category,
      reason: rule.reason,
    });
    return;
  }

  const platformLabel = META_LEAD_SOURCE[resolvePlatform(submission.platform)];
  const { decision, model, raw } = await decideFirstTouch({
    lead,
    formSummary: summary,
    platformLabel,
  });

  const { data: run } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      lead_id: lead.id,
      thread_id: thread.id,
      action: decision.action,
      model,
      prompt_version: META_FIRST_TOUCH_PROMPT_VERSION,
      audit_summary: decision.audit_summary,
      escalation_category: decision.escalation_category,
      proposed_lifecycle: decision.proposed_lifecycle,
      lead_field_updates: (decision.lead_field_updates ?? null) as never,
      policy_tags: decision.policy_tags,
      raw_decision: {
        ...(raw as Record<string, unknown>),
        meta_lead_id: metaLeadId,
        draft_text: decision.reply_text,
      } as never,
    })
    .select("id")
    .single();

  await recordHealth({
    provider: "xai",
    checkName: "agent_decision",
    ok: true,
    detail: `meta:${decision.action}`,
  });

  if (decision.lead_field_updates && Object.keys(decision.lead_field_updates).length > 0) {
    const updates = sanitizeLeadUpdates(decision.lead_field_updates);
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin
        .from("leads")
        .update(updates as never)
        .eq("id", lead.id);
      await addEvent(
        lead.id,
        "lead_fields_updated",
        "Agent updated lead details from Meta form",
        "grok",
        updates,
      );
    }
  }

  if (decision.action === "escalate") {
    await openEscalation({
      leadId: lead.id,
      threadId: thread.id,
      category: decision.escalation_category ?? "other_high_risk",
      reason: decision.audit_summary || "Agent requested human review of Meta lead",
      agentRunId: run?.id ?? null,
    });
    return;
  }

  if (decision.action !== "send" || !decision.reply_text) {
    await addEvent(
      lead.id,
      "meta_first_touch_no_reply",
      decision.audit_summary || "Agent chose no reply",
      "grok",
      {
        meta_lead_id: metaLeadId,
        agent_run_id: run?.id ?? null,
      },
    );
    return;
  }

  // Unsolicited first texts need explicit SMS consent captured on the form AND
  // the owner's opt-in switch. Otherwise it stays a draft for staff, who send
  // it through the inbox (communications.send).
  const autoAllowed = autoFirstTouchEnabled() && lead.consent_status === "opted_in";
  if (!autoAllowed) {
    await addEvent(
      lead.id,
      "first_touch_draft_ready",
      "Grok drafted a first-touch SMS; staff review required before sending",
      "grok",
      {
        meta_lead_id: metaLeadId,
        agent_run_id: run?.id ?? null,
        blocked_by: autoFirstTouchEnabled() ? "no_sms_consent" : "auto_first_touch_disabled",
      },
    );
    return;
  }

  const outcome = await sendOutbound({
    leadId: lead.id,
    threadId: thread.id,
    to: lead.phone_e164,
    text: decision.reply_text,
    idempotencyKey: `meta-first-touch:${metaLeadId}`,
    actor: "grok",
  });
  if (!outcome.ok) {
    await openEscalation({
      leadId: lead.id,
      threadId: thread.id,
      category: "other_high_risk",
      reason: `Automated first touch could not be sent: ${outcome.reason}`,
      agentRunId: run?.id ?? null,
    });
  }
}
