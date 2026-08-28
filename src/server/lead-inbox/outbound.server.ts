// Single outbound send path: capability check, reservation, idempotency, audit.
import { logCorrelation } from "./correlation-log";
import { resolveSmsCapability, sendSms, redact } from "./ringcentral.server";
import { requireSecret } from "./env.server";
import { validateOutbound } from "./safety.server";
import {
  addEvent,
  completeOutboundSendReservation,
  failOutboundSendReservation,
  findOutboundMessageByIdempotencyKey,
  markOutboundSendAmbiguous,
  recordHealth,
  recordOutboundMessage,
  reserveOutboundSend,
  toE164,
} from "./store.server";
import type { MessageRow } from "./store.server";

let capabilityCache: { value: Awaited<ReturnType<typeof resolveSmsCapability>>; at: number } | undefined;

export async function cachedCapability(force = false) {
  if (!force && capabilityCache && Date.now() - capabilityCache.at < 10 * 60_000) {
    return capabilityCache.value;
  }
  const value = await resolveSmsCapability();
  capabilityCache = { value, at: Date.now() };
  return value;
}

export type SendOutcome =
  | { ok: true; message: MessageRow | null; duplicate: boolean }
  | { ok: false; reason: string; tags?: string[]; requiresReview?: boolean };

export async function sendOutbound(args: {
  leadId: string;
  threadId: string;
  to: string;
  text: string;
  idempotencyKey: string;
  actor: string;
  correlationId?: string | null;
}): Promise<SendOutcome> {
  const check = validateOutbound(args.text);
  if (!check.ok) {
    await addEvent(
      args.leadId,
      "outbound_blocked",
      "Outbound text blocked by policy validation",
      args.actor,
      { tags: check.tags },
      undefined,
      args.correlationId,
    );
    return { ok: false, reason: "Blocked by outbound policy validation", tags: check.tags };
  }

  const capability = await cachedCapability();
  if (
    capability.capability === "none" ||
    capability.capability === "unknown" ||
    !capability.fromNumberConfigured
  ) {
    await recordHealth({
      provider: "ringcentral",
      checkName: "sms_capability",
      ok: false,
      detail: capability.detail,
    });
    return { ok: false, reason: `Sending number is not SMS-capable: ${capability.detail}` };
  }

  const to = toE164(args.to);
  const reservation = await reserveOutboundSend({
    idempotencyKey: args.idempotencyKey,
    correlationId: args.correlationId,
    leadId: args.leadId,
    threadId: args.threadId,
    recipientE164: to,
    body: args.text,
  });

  logCorrelation(args.correlationId, "outbound_reservation", {
    action: reservation.action,
    status: reservation.status,
    idempotency_key: args.idempotencyKey,
    actor: args.actor,
  });

  if (reservation.action === "skip") {
    return { ok: true, message: null, duplicate: true };
  }

  if (reservation.action === "review") {
    await addEvent(
      args.leadId,
      "outbound_blocked",
      reservation.reason ?? "Outbound send requires human review",
      args.actor,
      { idempotency_key: args.idempotencyKey, reservation_status: reservation.status },
      undefined,
      args.correlationId,
    );
    return {
      ok: false,
      reason: reservation.reason ?? "Outbound send requires human review",
      requiresReview: true,
    };
  }

  try {
    const result = await sendSms({ to, text: args.text, capability: capability.capability });
    let message: MessageRow | null = null;
    try {
      message = await recordOutboundMessage({
        leadId: args.leadId,
        threadId: args.threadId,
        body: args.text,
        recipient: to,
        sender: requireSecret("RINGCENTRAL_FROM_NUMBER"),
        idempotencyKey: args.idempotencyKey,
        deliveryState: result.deliveryState,
        providerMessageId: result.providerMessageId,
        providerCreatedAt: result.providerCreatedAt,
        metadata: result.raw,
        correlationId: args.correlationId,
      });
      if (message === null) {
        message = await findOutboundMessageByIdempotencyKey(args.idempotencyKey);
      }
      await completeOutboundSendReservation({
        idempotencyKey: args.idempotencyKey,
        providerMessageId: result.providerMessageId,
        messageId: message?.id ?? null,
      });
    } catch (persistError) {
      await markOutboundSendAmbiguous({
        idempotencyKey: args.idempotencyKey,
        providerMessageId: result.providerMessageId,
        detail: persistError instanceof Error ? persistError.message : String(persistError),
      });
      throw persistError;
    }

    await addEvent(
      args.leadId,
      "outbound_sent",
      `Outbound SMS sent by ${args.actor}`,
      args.actor,
      { provider_message_id: result.providerMessageId, idempotency_key: args.idempotencyKey },
      undefined,
      args.correlationId,
    );
    await recordHealth({ provider: "ringcentral", checkName: "send_sms", ok: true });
    return { ok: true, message, duplicate: message === null };
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error));
    await failOutboundSendReservation({ idempotencyKey: args.idempotencyKey, error: detail });
    await recordHealth({ provider: "ringcentral", checkName: "send_sms", ok: false, detail });
    return { ok: false, reason: detail };
  }
}
