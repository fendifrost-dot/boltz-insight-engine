import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request): Promise<Response> {
  const { authorizeCron, reconcileMessages } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const result = await reconcileMessages();
  const { processJobs } = await import("@/server/lead-inbox/jobs.server");
  const processed = result.enqueued > 0 ? await processJobs() : null;
  return Response.json({ ...result, processed });
}

export const Route = createFileRoute("/api/public/cron/reconcile-messages")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          console.error("[cron reconcile-messages]", error instanceof Error ? error.message : error);
          return Response.json({ error: "reconcile-messages failed" }, { status: 500 });
        }
      },
    },
  },
});
