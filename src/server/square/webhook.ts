import { parseSquareNotification, type ParsedSquareEvent } from "./events.ts";
import { verifySquareSignature } from "./signature.ts";

export type WebhookClaim = "new" | "duplicate" | "retry";

export async function processSquareWebhook(args: {
  rawBody: string;
  signatureHeader: string | null;
  signatureKey: string | null;
  notificationUrl: string | null;
  claim: (event: {
    eventId: string;
    eventType: string;
    objectId: string | null;
  }) => Promise<WebhookClaim>;
  apply: (event: ParsedSquareEvent) => Promise<void>;
  finish: (eventId: string, status: "processed" | "failed" | "ignored") => Promise<void>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!args.signatureKey || !args.notificationUrl) {
    return { status: 503, body: { error: "Square webhook is not configured" } };
  }
  const valid = verifySquareSignature({
    rawBody: args.rawBody,
    signatureHeader: args.signatureHeader,
    signatureKey: args.signatureKey,
    notificationUrl: args.notificationUrl,
  });
  if (!valid) return { status: 403, body: { error: "Invalid signature" } };

  let payload: unknown;
  try {
    payload = JSON.parse(args.rawBody) as unknown;
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const event = parseSquareNotification(payload);
  if (!event) return { status: 400, body: { error: "Invalid event" } };

  const claim = await args.claim({
    eventId: event.eventId,
    eventType: event.eventType,
    objectId: event.objectId,
  });
  if (claim === "duplicate") return { status: 200, body: { ok: true, duplicate: true } };

  try {
    if (event.kind === "other") {
      await args.finish(event.eventId, "ignored");
      return { status: 200, body: { ok: true, ignored: true } };
    }
    await args.apply(event);
    await args.finish(event.eventId, "processed");
    return { status: 200, body: { ok: true, duplicate: false } };
  } catch {
    await args.finish(event.eventId, "failed").catch(() => undefined);
    return { status: 500, body: { error: "Event processing failed" } };
  }
}
