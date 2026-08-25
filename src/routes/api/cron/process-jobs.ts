import { createFileRoute } from "@tanstack/react-router";
import { getCronSecret } from "@/lib/server/env.server";
import { processInboundJob } from "@/server/lead-inbox/inbound.server";
import { claimPendingJobs, completeJob, failJob } from "@/server/lead-inbox/jobs.server";

export const Route = createFileRoute("/api/cron/process-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCron(request)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const jobs = await claimPendingJobs(20);
        let succeeded = 0;
        let failed = 0;

        for (const job of jobs) {
          try {
            if (job.job_type === "process_inbound") {
              await processInboundJob(job);
            }
            await completeJob(job.id);
            succeeded += 1;
          } catch (err) {
            failed += 1;
            await failJob(job.id, err instanceof Error ? err.message : "job failed");
          }
        }

        return Response.json({ ok: true, claimed: jobs.length, succeeded, failed });
      },
    },
  },
});

function authorizeCron(request: Request): boolean {
  try {
    const secret = getCronSecret();
    const header = request.headers.get("authorization") ?? "";
    return header === `Bearer ${secret}`;
  } catch {
    return false;
  }
}
