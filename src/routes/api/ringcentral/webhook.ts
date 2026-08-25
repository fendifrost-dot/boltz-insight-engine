import { createFileRoute } from "@tanstack/react-router";
import { getRingCentralConfig } from "@/lib/server/env.server";
import { ingestRingCentralWebhook } from "@/server/lead-inbox/inbound.server";

/**
 * Stable public webhook path for RingCentral SMS instant notifications.
 * Validation: echo Validation-Token header exactly during subscription creation.
 * Later deliveries: verify configured verification token.
 * Returns quickly — durable jobs handle Grok processing.
 */
export const Route = createFileRoute("/api/ringcentral/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return handleWebhook(request);
      },
      POST: async ({ request }) => {
        return handleWebhook(request);
      },
    },
  },
});

async function handleWebhook(request: Request): Promise<Response> {
  const validationToken =
    request.headers.get("Validation-Token") ?? request.headers.get("validation-token");

  // Subscription creation handshake — echo exactly, no body processing required.
  if (validationToken) {
    return new Response("", {
      status: 200,
      headers: {
        "Validation-Token": validationToken,
        "Content-Type": "text/plain",
      },
    });
  }

  let configToken: string;
  try {
    configToken = getRingCentralConfig().webhookValidationToken;
  } catch {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const verificationHeader =
    request.headers.get("Verification-Token") ??
    request.headers.get("verification-token") ??
    request.headers.get("X-RingCentral-Verification-Token");

  // Require verification token on non-validation deliveries when configured.
  if (!verificationHeader || verificationHeader !== configToken) {
    console.info("[ringcentral.webhook] rejected delivery: verification token mismatch");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // Fire-and-forget style: await ingest (DB write + enqueue) but never wait on Grok.
  try {
    const result = await ingestRingCentralWebhook(payload as never);
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error(
      "[ringcentral.webhook] ingest failed",
      err instanceof Error ? err.message : "error",
    );
    // Still 200 when possible to avoid RC retry storms for poison payloads we persisted;
    // return 500 only for unexpected failures so RC retries.
    return Response.json({ ok: false }, { status: 500 });
  }
}
