import { createFileRoute } from "@tanstack/react-router";

/**
 * Weekly Google Ads call counts. Read-only.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (the shared cron bearer).
 * `since` and `until` are YYYY-MM-DD in America/Chicago. Omit both to use the
 * last full Monday–Sunday week. The GAQL is fixed server-side.
 * GET and POST both run the pull. The request body is ignored.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const { adsConfigError } = await import("@/server/google-ads/env.server");
  const configError = adsConfigError();
  if (configError) return Response.json({ error: configError }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const { isCallWindow, resolveCallWindow } = await import("@/server/google-ads/call-report");
  const window = resolveCallWindow({
    since: params.get("since"),
    until: params.get("until"),
    now: new Date(),
  });
  if (!isCallWindow(window)) return Response.json({ error: window.error }, { status: 400 });

  const { pullAdsCallReport } = await import("@/server/google-ads/call-report.server");
  const report = await pullAdsCallReport(window);
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}

async function handle(request: Request): Promise<Response> {
  try {
    return await run(request);
  } catch (error) {
    console.error(
      "[cron ads-calls]",
      error instanceof Error
        ? error.message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200)
        : "failed",
    );
    return Response.json({ error: "ads-calls failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/ads-calls")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
