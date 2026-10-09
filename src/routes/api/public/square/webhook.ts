import { createFileRoute } from "@tanstack/react-router";

/**
 * Square webhook. Rejects every event until SQUARE_WEBHOOK_SIGNATURE_KEY and
 * PUBLIC_APP_URL are set. The signature covers the exact notification URL plus
 * the raw body. Bad signatures are rejected. Event ids are deduped.
 */
async function receive(request: Request): Promise<Response> {
  const { receiveSquareWebhook } = await import("@/server/square/webhook.server");
  return receiveSquareWebhook(request);
}

export const Route = createFileRoute("/api/public/square/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await receive(request);
        } catch (error) {
          const { redactSquareText } = await import("@/server/square/errors");
          const code = error instanceof Error ? error.message : "failed";
          console.error("[square webhook]", redactSquareText(code));
          return Response.json({ error: "square webhook failed" }, { status: 500 });
        }
      },
    },
  },
});
