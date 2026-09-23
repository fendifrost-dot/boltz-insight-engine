import { createFileRoute } from "@tanstack/react-router";

/**
 * Monday "Ads Weekly" reporting endpoint. Read-only.
 *
 * Auth reuses the existing cron bearer (`Authorization: Bearer <CRON_SECRET>`),
 * so this adds no second auth mechanism. Credentials for Google Ads are
 * server-side only — the caller never supplies or receives them, and the agent
 * calling this does not need a signed-in browser session.
 *
 * Optional `?days=N` (1–90, default 7) only sets the lookback length; the GAQL
 * itself is fixed server-side.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const { adsConfigError } = await import("@/server/google-ads/env.server");
  const configError = adsConfigError();
  if (configError) {
    // Operator-actionable, and distinct from a transient provider failure.
    return Response.json({ error: configError }, { status: 503 });
  }

  const daysParam = new URL(request.url).searchParams.get("days");
  const parsedDays = daysParam === null ? undefined : Number(daysParam);
  if (
    parsedDays !== undefined &&
    (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 90)
  ) {
    return Response.json({ error: "days must be an integer between 1 and 90" }, { status: 400 });
  }

  const { getAdsWeeklyReport } = await import("@/server/google-ads/reports.server");
  const report = await getAdsWeeklyReport({ days: parsedDays });
  return Response.json(report);
}

export const Route = createFileRoute("/api/public/cron/ads-weekly")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          // Provider errors are redacted inside the Ads client before they reach here.
          const detail = error instanceof Error ? error.message : "Unknown Google Ads error";
          console.error("[cron ads-weekly]", detail);
          return Response.json({ error: "ads-weekly failed", detail }, { status: 500 });
        }
      },
    },
  },
});
