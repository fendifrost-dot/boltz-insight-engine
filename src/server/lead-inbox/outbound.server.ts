// Single outbound send path: capability check, idempotency, audit.
import { resolveSmsCapability, sendSms, redact } from "./ringcentral.server";
import { requireSecret } from "./env.server";
import { validateOutbound } from "./safety.server";
import { addEvent, recordHealth, recordOutboundMessage, toE164 } from "./store.server";
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
  | { ok: false; reason: string; tags?: string[] };

export async function sendOutbound(args: {
  leadId: string;
  threadId: string;
  to: string;
  text: string;
  idempotencyKey: string;
  actor: string;
}): Promise<SendOutcome> {
  const check = validateOutbound(args.text);
  if (!check.ok) {
    await addEvent(args.leadId, "outbound_blocked", "Outbound text blocked by policy validation", args.actor, {
      tags: check.tags,
    });
    return { ok: false, reason: "Blocked by outbound policy validation", tags: check.tags };
  }

  const capability = await cachedCapability();
  if (capability.capability === "none" || !capability.fromNumberConfigured) {
    await recordHealth({
      provider: "ringcentral",
      checkName: "sms_capability",
      ok: false,
      detail: capability.detail,
    });
    return { ok: false, reason: `Sending number is not SMS-capable: ${capability.detail}` };
  }

  const to = toE164(args.to);
  try {
    const result = await sendSms({ to, text: args.text, capability: capability.capability });
    const message = await recordOutboundMessage({
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
    });
    await addEvent(args.leadId, "outbound_sent", `Outbound SMS sent by ${args.actor}`, args.actor, {
      provider_message_id: result.providerMessageId,
    });
    await recordHealth({ provider: "ringcentral", checkName: "send_sms", ok: true });
    return { ok: true, message, duplicate: message === null };
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error));
    await recordHealth({ provider: "ringcentral", checkName: "send_sms", ok: false, detail });
    return { ok: false, reason: detail };
  }
}
