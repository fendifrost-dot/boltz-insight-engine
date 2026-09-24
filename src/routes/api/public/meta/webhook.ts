// Meta Lead Ads (Page `leadgen`) webhook. Public prefix (external caller);
// authenticated in-handler: GET verify-token handshake, POST X-Hub-Signature-256.
import { createFileRoute } from "@tanstack/react-router";

async function verify(request: Request): Promise<Response> {
  const { readMetaSecret } = await import("@/server/meta-leads/env.server");
  const { verifyHandshake } = await import("@/server/meta-leads/signature");
  const expected = readMetaSecret("META_WEBHOOK_VERIFY_TOKEN");
  if (!expected) return new Response("Webhook not configured", { status: 503 });
  const challenge = verifyHandshake(new URL(request.url).searchParams, expected);
  if (challenge === null) return new Response("Verification failed", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

async function receive(request: Request): Promise<Response> {
  const { readMetaSecret } = await import("@/server/meta-leads/env.server");
  const { verifyMetaSignature } = await import("@/server/meta-leads/signature");
  const { recordHealth } = await import("@/server/lead-inbox/store.server");

  const appSecret = readMetaSecret("META_APP_SECRET");
  if (!appSecret) return new Response("Webhook not configured", { status: 503 });

  // Signature covers the exact bytes Meta sent; read raw before parsing.
  const rawBody = await request.text();
  const valid = await verifyMetaSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    appSecret,
  );
  if (!valid) {
    await recordHealth({
      provider: "meta",
      checkName: "webhook_signature_invalid",
      ok: false,
      detail: request.headers.get("x-hub-signature-256")
        ? "signature mismatch"
        : "signature header missing",
    });
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { parseLeadgenEvents } = await import("@/server/meta-leads/normalize");
  const events = parseLeadgenEvents(payload);
  await recordHealth({
    provider: "meta",
    checkName: "webhook_received",
    ok: true,
    detail: `${events.length} leadgen event(s)`,
    metadata: { leadgen_ids: events.map((e) => e.leadgenId).slice(0, 20) },
  });
  if (events.length === 0) return new Response(null, { status: 200 });

  // Durable receipts are written before any Graph call. If this throws, the
  // 500 makes Meta retry; once receipts exist, fetch failures are left to
  // reconciliation and Meta still gets its 200.
  const { handleLeadgenEvents } = await import("@/server/meta-leads/ingest.server");
  const summary = await handleLeadgenEvents(events, payload);
  if (summary.ingested > 0) {
    // Grok runs from the queue after ingestion; drain a little inline for latency.
    const { processJobs } = await import("@/server/lead-inbox/jobs.server");
    await processJobs(2).catch((error: unknown) =>
      console.error("[meta webhook] job drain", error instanceof Error ? error.message : error),
    );
  }
  return Response.json(summary, { status: 200 });
}

export const Route = createFileRoute("/api/public/meta/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await verify(request);
        } catch (error) {
          console.error("[meta webhook verify]", error instanceof Error ? error.message : error);
          return new Response("Verification error", { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          return await receive(request);
        } catch (error) {
          console.error("[meta webhook]", error instanceof Error ? error.message : error);
          return new Response("Webhook processing error", { status: 500 });
        }
      },
    },
  },
});
