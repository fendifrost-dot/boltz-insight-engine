import { createFileRoute } from "@tanstack/react-router";

/**
 * Square backfill and incremental sync. Read-only against Square.
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 * `?mode=incremental` (default) or `?mode=backfill&since=YYYY-MM-DD`.
 * Backfill `since` may also come from SQUARE_BACKFILL_SINCE.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const { parseSinceDate } = await import("@/server/square/rollup");
  const { readBackfillSince } = await import("@/server/square/env.server");

  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "incremental";
  if (mode !== "incremental" && mode !== "backfill") {
    return Response.json({ error: "mode must be incremental or backfill" }, { status: 400 });
  }

  let since: string | null = null;
  if (mode === "backfill") {
    const parsed = parseSinceDate(params.get("since") ?? readBackfillSince() ?? null);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    since = parsed.date;
  }

  const { runSquareSync } = await import("@/server/square/sync.server");
  const report = await runSquareSync({ mode, since });
  if (!report.configured) {
    return Response.json({ configured: false, error: report.reason }, { status: 503 });
  }
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}

async function handle(request: Request): Promise<Response> {
  try {
    return await run(request);
  } catch (error) {
    const { redactSquareText } = await import("@/server/square/errors");
    const code = error instanceof Error ? error.message : "failed";
    console.error("[cron square-sync]", redactSquareText(code));
    return Response.json({ error: "square-sync failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/square-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
