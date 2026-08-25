import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request): Promise<Response> {
  const { authorizeCron, renewSubscriptions, verifySubscriptionStatus } = await import(
    "@/server/lead-inbox/cron.server"
  );
  const denied = authorizeCron(request);
  if (denied) return denied;

  await verifySubscriptionStatus();
  const result = await renewSubscriptions();
  return Response.json(result);
}

export const Route = createFileRoute("/api/public/cron/renew-subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          console.error("[cron renew-subscriptions]", error instanceof Error ? error.message : error);
          return Response.json({ error: "renew-subscriptions failed" }, { status: 500 });
        }
      },
    },
  },
});
