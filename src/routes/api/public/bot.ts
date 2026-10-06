import { createFileRoute } from "@tanstack/react-router";

/**
 * Cookie-less bot API for lead lookup and SMS.
 * Auth: header `X-Bot-Api-Secret` only.
 * The cron bearer token and staff JWTs are not accepted here. Staff inbox routes are unchanged.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeBotRequest } = await import("@/server/lead-inbox/bot-api.policy");
  const { readSecret } = await import("@/server/lead-inbox/env.server");
  const denied = authorizeBotRequest(request, readSecret("BOT_API_SECRET"));
  if (denied) return denied;

  const { handleBotRequest } = await import("@/server/lead-inbox/bot-api.server");
  return handleBotRequest(request);
}

export const Route = createFileRoute("/api/public/bot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          const message = error instanceof Error ? error.message : "bot request failed";
          console.error("[bot api]", message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200));
          return Response.json(
            { error: "Bot request failed" },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
