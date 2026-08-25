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

  // RingCentral webhook handshake: echo the validation token back.
  const validationToken = request.headers.get("validation-token");
  const expected = readSecret("RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN");
  if (!expected) return new Response("Webhook not configured", { status: 503 });
  if (!validationToken || !safeEqual(validationToken, expected)) {
    return new Response("Invalid validation token", { status: 401 });
  }

  const rawBody = await request.text();
  if (!rawBody) {
    return new Response(null, { status: 200, headers: { "Validation-Token": validationToken } });
  }

  const { enqueueJob, recordHealth } = await import("@/server/lead-inbox/store.server");
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
    const job = await enqueueJob({
      jobType: "process_inbound",
      inboundProviderMessageId: String(message.id),
      payload: {
        provider_message_id: String(message.id),
        body: message.subject ?? "",
        from: message.from.phoneNumber,
        to: (message.to ?? []).map((t) => t.phoneNumber).filter((p): p is string => Boolean(p)),
        provider_created_at: message.creationTime ?? null,
        channel: message.type === "MMS" ? "MMS" : "SMS",
      },
    });
    if (job) {
      // Bounded inline drain keeps reply latency low without unbounded fan-out.
      await processJobs(3);
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
