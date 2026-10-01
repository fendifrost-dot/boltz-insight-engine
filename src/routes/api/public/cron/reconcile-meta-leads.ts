import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  mode: z.enum(["diagnose", "backfill"]).optional(),
  since: z.string().trim().max(40).optional(),
  contactedPhones: z.array(z.string().trim().max(40)).max(500).optional(),
});

/**
 * Meta Lead Ads reconciliation.
 * `?window=incremental` (default) or `?window=nightly`; `?minutes=N` overrides lookback.
 * `?mode=diagnose` lists form ids, owning page, question keys, and counts.
 * `?mode=backfill&since=YYYY-MM-DD` ingests since that UTC day without enqueueing
 * first-touch jobs. `contactedPhones` is accepted only in the JSON body.
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */
async function readOptionalJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const { metaConfigError } = await import("@/server/meta-leads/env.server");
  const configError = metaConfigError();
  if (configError) {
    // Leave a trace in the health log (secret names only, never values) so a
    // scheduled run that can't start is visible, not silent.
    const { recordHealth } = await import("@/server/lead-inbox/store.server");
    await recordHealth({ provider: "meta", checkName: "config", ok: false, detail: configError });
    return Response.json({ error: configError }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  if (params.has("contactedPhones") || params.has("phones")) {
    return Response.json(
      { error: "contactedPhones must be sent in the JSON body" },
      { status: 400 },
    );
  }

  const body = await readOptionalJson(request);
  if (!body) return Response.json({ error: "Invalid request body" }, { status: 400 });
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) return Response.json({ error: "Invalid request body" }, { status: 400 });

  const queryMode = params.get("mode");
  const mode = parsedBody.data.mode ?? (queryMode === null ? "reconcile" : queryMode);
  if (mode !== "reconcile" && mode !== "diagnose" && mode !== "backfill") {
    return Response.json(
      { error: "mode must be reconcile, diagnose, or backfill" },
      { status: 400 },
    );
  }

  const sinceRaw = parsedBody.data.since ?? params.get("since") ?? undefined;
  let since: { sinceMs: number; sinceUnix: number; iso: string } | undefined;
  if (sinceRaw) {
    const { parseBackfillSince } = await import("@/server/meta-leads/backfill");
    const { MAX_LOOKBACK_MINUTES } = await import("@/server/meta-leads/reconcile.server");
    const parsedSince = parseBackfillSince(sinceRaw, Date.now(), MAX_LOOKBACK_MINUTES);
    if ("error" in parsedSince) return Response.json({ error: parsedSince.error }, { status: 400 });
    since = parsedSince;
  }
  if (mode === "backfill" && !since) {
    return Response.json({ error: "since is required for backfill" }, { status: 400 });
  }

  if (mode === "diagnose") {
    const { diagnoseMetaLeadForms } = await import("@/server/meta-leads/reconcile.server");
    const report = await diagnoseMetaLeadForms({
      sinceUnix: since?.sinceUnix,
      sinceIso: since?.iso,
    });
    return Response.json(report);
  }

  if (mode === "backfill") {
    const { contactedPhoneSet } = await import("@/server/meta-leads/backfill");
    const { reconcileMetaLeads } = await import("@/server/meta-leads/reconcile.server");
    const contacted = contactedPhoneSet(parsedBody.data.contactedPhones ?? []);
    const summary = await reconcileMetaLeads({
      window: "backfill",
      sinceMs: since?.sinceMs,
      sinceUnix: since?.sinceUnix,
      suppressFirstTouch: true,
      contactedPhones: contacted.phones,
      contactedIgnored: contacted.ignored,
    });
    return Response.json(summary);
  }

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
