/**
 * Shared RingCentral outbound sending + lifecycle side effects.
 * Manual and automated sends must go through this module.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/integrations/ringcentral/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { LeadLifecycle } from "@/lib/lead-inbox/constants";
import { getRingCentralConfig } from "@/lib/server/env.server";
import { normalizeToE164 } from "@/lib/server/phone.server";

export class OutboundSendError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OutboundSendError";
    this.code = code;
  }
}

export async function recordLeadEvent(input: {
  leadId: string;
  eventType: string;
  fromLifecycle?: LeadLifecycle | null;
  toLifecycle?: LeadLifecycle | null;
  actor?: string | null;
  summary?: string | null;
  metadata?: Json | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("lead_events").insert({
    lead_id: input.leadId,
    event_type: input.eventType,
    from_lifecycle: input.fromLifecycle ?? null,
    to_lifecycle: input.toLifecycle ?? null,
    actor: input.actor ?? null,
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
  });
  if (error) {
    throw new Error(`Failed to record lead event: ${error.message}`);
  }
}

export async function transitionLeadLifecycle(input: {
  leadId: string;
  to: LeadLifecycle;
  actor: string;
  summary?: string | null;
}): Promise<{ changed: boolean; from: LeadLifecycle | null }> {
  const { data: lead, error } = await supabaseAdmin
    .from("leads")
    .select("id, lifecycle")
    .eq("id", input.leadId)
    .maybeSingle();

  if (error || !lead) {
    throw new Error(error?.message ?? "Lead not found");
  }

  const from = lead.lifecycle as LeadLifecycle;
  if (from === input.to) {
    return { changed: false, from };
  }

  const { error: updateError } = await supabaseAdmin
    .from("leads")
    .update({ lifecycle: input.to })
    .eq("id", input.leadId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await recordLeadEvent({
    leadId: input.leadId,
    eventType: "lifecycle_transition",
    fromLifecycle: from,
    toLifecycle: input.to,
    actor: input.actor,
    summary: input.summary ?? `Lifecycle ${from} → ${input.to}`,
  });

  return { changed: true, from };
}

/**
 * Send an outbound SMS via RingCentral and persist the message.
 * Moves New → Contacted only after RingCentral accepts the send.
 */
export async function sendOutboundSms(input: {
  leadId: string;
  threadId: string;
  toE164: string;
  body: string;
  actor: string;
  idempotencyKey?: string | null;
}): Promise<{ messageId: string; providerMessageId: string }> {
  const to = normalizeToE164(input.toE164);
  if (!to) {
    throw new OutboundSendError("invalid_to", "Recipient phone is not valid E.164");
  }

  const { data: lead, error: leadError } = await supabaseAdmin
    .from("leads")
    .select("id, lifecycle, consent_status, phone_e164")
    .eq("id", input.leadId)
    .maybeSingle();

  if (leadError || !lead) {
    throw new OutboundSendError("lead_missing", leadError?.message ?? "Lead not found");
  }

  if (lead.consent_status === "opted_out") {
    throw new OutboundSendError("opted_out", "Cannot send SMS to an opted-out lead");
  }

  if (input.idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from("messages")
      .select("id, provider_message_id")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing?.id) {
      return {
        messageId: existing.id,
        providerMessageId: existing.provider_message_id ?? "",
      };
    }
  }

  const config = getRingCentralConfig();

  const { data: pending, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      thread_id: input.threadId,
      lead_id: input.leadId,
      direction: "outbound",
      provider: "ringcentral",
      sender_e164: config.fromNumber,
      recipients_e164: [to],
      body: input.body,
      channel: "SMS",
      delivery_state: "sending",
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select("id")
    .single();

  if (insertError || !pending) {
    if (insertError?.code === "23505" && input.idempotencyKey) {
      const { data: existing } = await supabaseAdmin
        .from("messages")
        .select("id, provider_message_id")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing?.id) {
        return {
          messageId: existing.id,
          providerMessageId: existing.provider_message_id ?? "",
        };
      }
    }
    throw new OutboundSendError(
      "persist_failed",
      insertError?.message ?? "Failed to persist outbound message",
    );
  }

  try {
    const result = await sendSms({
      from: config.fromNumber,
      to,
      text: input.body,
    });

    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        provider_message_id: result.providerMessageId,
        delivery_state: result.deliveryState,
        provider_metadata_redacted: result.rawRedacted as Json,
        provider_created_at: new Date().toISOString(),
      })
      .eq("id", pending.id);

    if (updateError) {
      throw new OutboundSendError("update_failed", updateError.message);
    }

    await supabaseAdmin
      .from("message_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", input.threadId);

    await supabaseAdmin
      .from("leads")
      .update({
        last_message_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
      })
      .eq("id", input.leadId);

    if (lead.lifecycle === "New") {
      await transitionLeadLifecycle({
        leadId: input.leadId,
        to: "Contacted",
        actor: input.actor,
        summary: "Outbound SMS accepted by RingCentral",
      });
    }

    await recordLeadEvent({
      leadId: input.leadId,
      eventType: "outbound_sms_accepted",
      actor: input.actor,
      summary: "Outbound SMS accepted by RingCentral",
      metadata: { message_id: pending.id, provider_message_id: result.providerMessageId },
    });

    return { messageId: pending.id, providerMessageId: result.providerMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Outbound send failed";
    await supabaseAdmin
      .from("messages")
      .update({
        delivery_state: "failed",
        error_message: message,
        error_code: err instanceof OutboundSendError ? err.code : "provider_error",
      })
      .eq("id", pending.id);

    await recordLeadEvent({
      leadId: input.leadId,
      eventType: "outbound_sms_failed",
      actor: input.actor,
      summary: "Outbound SMS failed",
      metadata: { message_id: pending.id, error: message },
    });

    throw err instanceof OutboundSendError ? err : new OutboundSendError("provider_error", message);
  }
}
