import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const { processJobs } = await import("@/server/lead-inbox/jobs.server");
  const summary = await processJobs();
  return Response.json(summary);
}

export const Route = createFileRoute("/api/public/cron/process-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          console.error("[cron process-jobs]", error instanceof Error ? error.message : error);
          return Response.json({ error: "process-jobs failed" }, { status: 500 });
        }
      },
    },
  },
});
