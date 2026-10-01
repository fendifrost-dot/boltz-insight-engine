import { createFileRoute } from "@tanstack/react-router";

/**
 * Lead intake for Yelp, Durable, Google notification mail, and Google Ads
 * lead forms. `mode=dry-run` writes nothing. `mode=backfill` (default since
 * 2026-09-26) and incremental both insert leads and never enqueue a first touch.
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "incremental";
  if (mode !== "incremental" && mode !== "backfill" && mode !== "dry-run") {
    return Response.json({ error: "mode must be incremental, backfill, or dry-run" }, { status: 400 });
  }

  const { EMAIL_INTAKE_DEFAULT_SINCE, EMAIL_INTAKE_LOOKBACK_MS, parseIntakeSince } = await import(
    "@/server/intake/gmail-query"
  );
  const now = Date.now();
  const fallback =
    mode === "incremental" ? now - EMAIL_INTAKE_LOOKBACK_MS : Date.parse(EMAIL_INTAKE_DEFAULT_SINCE);
  const since = parseIntakeSince(params.get("since") ?? undefined, now, fallback);
  if ("error" in since) return Response.json({ error: since.error }, { status: 400 });

  const { ingestEmailLeads } = await import("@/server/intake/email-ingest.server");
  const { ingestGoogleAdsLeads } = await import("@/server/intake/google-ads-ingest.server");
  const email = await ingestEmailLeads({ mode, sinceMs: since.sinceMs });
  const ads = await ingestGoogleAdsLeads({ sinceMs: since.sinceMs, dryRun: mode === "dry-run" });

  if (mode !== "dry-run") {
    const { recordHealth } = await import("@/server/lead-inbox/store.server");
    const emailDetail =
      email.error ??
      `scanned ${email.scanned}, parsed ${email.parsed}, ingested ${email.ingested}, duplicates ${email.duplicates}, skipped ${email.skipped}`;
    for (const provider of ["yelp", "durable", "google_lsa", "google_gbp"] as const) {
      await recordHealth({
        provider,
        checkName: "poll",
        ok: !email.error,
        detail: emailDetail,
        metadata: { bySource: email.bySource, truncated: email.truncated },
      });
    }
    await recordHealth({
      provider: "google_ads",
      checkName: "poll",
      ok: !ads.error,
      detail:
        ads.error ??
        `scanned ${ads.scanned}, ingested ${ads.ingested}, duplicates ${ads.duplicates}, skipped ${ads.skipped}`,
    });
    const { recordIntakeHealth } = await import("@/server/intake/health.server");
    await recordIntakeHealth(new Date(now));
  }

  return Response.json({ email, ads });
}

export const Route = createFileRoute("/api/public/cron/ingest-leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          console.error(
            "[cron ingest-leads]",
            error instanceof Error ? error.message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200) : "failed",
          );
          return Response.json({ error: "ingest-leads failed" }, { status: 500 });
        }
      },
    },
  },
});
