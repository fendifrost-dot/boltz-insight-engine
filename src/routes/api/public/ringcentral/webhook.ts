// RingCentral inbound webhook. Public prefix (external caller); validated in-handler.
import { createFileRoute } from "@tanstack/react-router";

type RcNotification = {
  event?: string;
  subscriptionId?: string;
  body?: {
    id?: number | string;
    from?: { phoneNumber?: string };
    to?: { phoneNumber?: string }[];
    subject?: string;
    type?: string;
    direction?: string;
    creationTime?: string;
    attachments?: { id?: number | string; contentType?: string }[];
  };
};

async function handle(request: Request): Promise<Response> {
  const { readSecret, safeEqual } = await import("@/server/lead-inbox/env.server");

  // Subscription handshake: RingCentral generates this one-time token.
  // Echo it exactly; it is distinct from our configured verification token.
  const validationToken = request.headers.get("validation-token");
  if (validationToken) {
    return new Response(null, {
      status: 200,
      headers: { "Validation-Token": validationToken },
    });
  }

  // Normal notifications carry the verification token supplied when the
  // subscription was created.
  const expected = readSecret("RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN");
  if (!expected) return new Response("Webhook not configured", { status: 503 });

  const verificationToken = request.headers.get("verification-token");
  if (!verificationToken || !safeEqual(verificationToken, expected)) {
    return new Response("Invalid verification token", { status: 401 });
  }

  const rawBody = await request.text();
  if (!rawBody) return new Response(null, { status: 200 });

  const { enqueueInboundMessageJob, recordHealth } = await import("@/server/lead-inbox/store.server");
  const { logCorrelation } = await import("@/server/lead-inbox/correlation-log");
  const { processJobs } = await import("@/server/lead-inbox/jobs.server");

  let notification: RcNotification;
  try {
    notification = JSON.parse(rawBody) as RcNotification;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  await recordHealth({
    provider: "ringcentral",
    checkName: "webhook_notification",
    ok: true,
    detail: notification.event ?? "notification",
  });

  const message = notification.body;
  const isInboundSms =
    message?.direction === "Inbound" && (message?.type === "SMS" || message?.type === "MMS");

  if (isInboundSms && message?.id != null && message.from?.phoneNumber) {
    const providerMessageId = String(message.id);
    const payload = {
      provider_message_id: providerMessageId,
      body: message.subject ?? "",
      from: message.from.phoneNumber,
      to: (message.to ?? []).map((t) => t.phoneNumber).filter((p): p is string => Boolean(p)),
      provider_created_at: message.creationTime ?? null,
      channel: message.type === "MMS" ? "MMS" : "SMS",
    };
    const enqueued = await enqueueInboundMessageJob({
      inboundProviderMessageId: providerMessageId,
      payload,
    });
    if (enqueued) {
      logCorrelation(enqueued.correlationId, "inbound_job_enqueued", {
        source: "webhook",
        created: enqueued.created,
        provider_message_id: providerMessageId,
      });
      if (enqueued.created) {
        // Bounded inline drain keeps reply latency low without unbounded fan-out.
        await processJobs(3);
      }
    }
  }

  return new Response(null, { status: 200 });
}

export const Route = createFileRoute("/api/public/ringcentral/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await handle(request);
        } catch (error) {
          console.error("[ringcentral webhook]", error instanceof Error ? error.message : error);
          return new Response("Webhook processing error", { status: 500 });
        }
      },
      GET: async () => new Response("ok", { status: 200 }),
    },
  },
});
