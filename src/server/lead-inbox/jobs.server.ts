/**
 * Durable job enqueue + claim helpers for inbound processing and retries.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export async function enqueueInboundProcessJob(input: {
  providerMessageId: string;
  leadId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  payload?: Json | null;
}): Promise<{ jobId: string; created: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("message_jobs")
    .insert({
      job_type: "process_inbound",
      status: "pending",
      inbound_provider_message_id: input.providerMessageId,
      lead_id: input.leadId ?? null,
      thread_id: input.threadId ?? null,
      message_id: input.messageId ?? null,
      payload: input.payload ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("message_jobs")
        .select("id")
        .eq("job_type", "process_inbound")
        .eq("inbound_provider_message_id", input.providerMessageId)
        .maybeSingle();
      if (existing?.id) {
        return { jobId: existing.id, created: false };
      }
    }
    throw new Error(`Failed to enqueue inbound job: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Failed to enqueue inbound job: missing id");
  }

  return { jobId: data.id, created: true };
}

type ClaimedJob = {
  id: string;
  job_type: string;
  payload: Record<string, unknown> | null;
  inbound_provider_message_id: string | null;
  lead_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  attempts: number;
  max_attempts: number;
};

export async function claimPendingJobs(limit = 10): Promise<ClaimedJob[]> {
  const now = new Date().toISOString();
  const { data: candidates, error } = await supabaseAdmin
    .from("message_jobs")
    .select(
      "id, job_type, payload, inbound_provider_message_id, lead_id, thread_id, message_id, attempts, max_attempts, status, run_after",
    )
    .in("status", ["pending", "failed"])
    .lte("run_after", now)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list jobs: ${error.message}`);
  }

  const claimed: ClaimedJob[] = [];
  for (const job of candidates ?? []) {
    if (job.attempts >= job.max_attempts) {
      await supabaseAdmin
        .from("message_jobs")
        .update({ status: "dead", last_error: "max attempts exceeded" })
        .eq("id", job.id);
      continue;
    }

    const { data: updated, error: claimError } = await supabaseAdmin
      .from("message_jobs")
      .update({
        status: "processing",
        locked_at: now,
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .in("status", ["pending", "failed"])
      .select(
        "id, job_type, payload, inbound_provider_message_id, lead_id, thread_id, message_id, attempts, max_attempts",
      )
      .maybeSingle();

    if (claimError || !updated) continue;
    claimed.push({
      id: updated.id,
      job_type: updated.job_type,
      payload: (updated.payload as Record<string, unknown> | null) ?? null,
      inbound_provider_message_id: updated.inbound_provider_message_id,
      lead_id: updated.lead_id,
      thread_id: updated.thread_id,
      message_id: updated.message_id,
      attempts: updated.attempts,
      max_attempts: updated.max_attempts,
    });
  }

  return claimed;
}

export async function completeJob(jobId: string): Promise<void> {
  await supabaseAdmin
    .from("message_jobs")
    .update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", jobId);
}

export async function failJob(
  jobId: string,
  errorMessage: string,
  retryDelaySeconds = 60,
): Promise<void> {
  const runAfter = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
  await supabaseAdmin
    .from("message_jobs")
    .update({
      status: "failed",
      last_error: errorMessage.slice(0, 1000),
      run_after: runAfter,
      locked_at: null,
    })
    .eq("id", jobId);
}

export async function retryJobSafely(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("message_jobs")
    .select("id, status, attempts, max_attempts")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }

  if (job.status === "succeeded" || job.status === "processing") {
    return { ok: false, error: `Cannot retry job in status ${job.status}` };
  }

  if (job.attempts >= job.max_attempts) {
    await supabaseAdmin
      .from("message_jobs")
      .update({
        status: "pending",
        attempts: 0,
        run_after: new Date().toISOString(),
        last_error: null,
        locked_at: null,
      })
      .eq("id", jobId);
  } else {
    await supabaseAdmin
      .from("message_jobs")
      .update({
        status: "pending",
        run_after: new Date().toISOString(),
        last_error: null,
        locked_at: null,
      })
      .eq("id", jobId);
  }

  return { ok: true };
}
