import { createFileRoute } from "@tanstack/react-router";

/**
 * Meta Lead Ads reconciliation. `?window=incremental` (default, schedule every
 * 10–15 min) or `?window=nightly`; `?minutes=N` overrides the lookback (max 90 days).
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const { metaConfigError } = await import("@/server/meta-leads/env.server");
  const configError = metaConfigError();
  if (configError) return Response.json({ error: configError }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const windowParam = params.get("window") ?? "incremental";
  if (windowParam !== "incremental" && windowParam !== "nightly") {
    return Response.json({ error: "window must be incremental or nightly" }, { status: 400 });
  }
  const minutesParam = params.get("minutes");
  const minutes = minutesParam === null ? undefined : Number(minutesParam);
  if (
    minutes !== undefined &&
    (!Number.isInteger(minutes) || minutes < 1 || minutes > 90 * 24 * 60)
  ) {
    return Response.json(
      { error: "minutes must be an integer between 1 and 129600" },
      { status: 400 },
    );
  }

  const { reconcileMetaLeads } = await import("@/server/meta-leads/reconcile.server");
  const summary = await reconcileMetaLeads({
    window: windowParam,
    lookbackMinutes: minutes,
  });

  const { processJobs } = await import("@/server/lead-inbox/jobs.server");
  const processed = summary.ingested > 0 ? await processJobs() : null;
  return Response.json({ ...summary, processed });
}

export const Route = createFileRoute("/api/public/cron/reconcile-meta-leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          console.error(
            "[cron reconcile-meta-leads]",
            error instanceof Error ? error.message : error,
          );
          return Response.json({ error: "reconcile-meta-leads failed" }, { status: 500 });
        }
      },
    },
  },
});
