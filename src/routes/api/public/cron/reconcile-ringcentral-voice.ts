import { createFileRoute } from "@tanstack/react-router";

/**
 * RingCentral voicemail and AI call-note sync.
 * `?window=incremental` (default, 180 minutes) or `?window=nightly` (7 days).
 * `?minutes=N` overrides the lookback, from 1 minute through 30 days.
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 * Does not send SMS, place calls, or enqueue first-touch jobs.
 */
async function run(request: Request): Promise<Response> {
  const { authorizeCron } = await import("@/server/lead-inbox/cron.server");
  const denied = authorizeCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const windowParam = params.get("window") ?? "incremental";
  if (windowParam !== "incremental" && windowParam !== "nightly") {
    return Response.json({ error: "window must be incremental or nightly" }, { status: 400 });
  }
  const minutesParam = params.get("minutes");
  const minutes = minutesParam === null ? undefined : Number(minutesParam);
  const { resolveLookbackMinutes } = await import("@/server/lead-inbox/voice-intake");
  const lookback = resolveLookbackMinutes({
    window: windowParam,
    ...(minutes !== undefined ? { minutes } : {}),
  });
  if (!lookback.ok) return Response.json({ error: lookback.error }, { status: 400 });

  const { missingSecretName, runVoiceSync, safeVoiceDetail } =
    await import("@/server/lead-inbox/voice-intake.server");
  try {
    const summary = await runVoiceSync(new Date(), lookback.minutes);
    return Response.json({ ok: true, window: windowParam, ...summary });
  } catch (error) {
    const missing = missingSecretName(error);
    if (missing) {
      return Response.json({ error: `Missing server secret: ${missing}` }, { status: 503 });
    }
    console.error(
      "[cron reconcile-ringcentral-voice]",
      safeVoiceDetail(error instanceof Error ? error.message : "sync failed"),
    );
    return Response.json({ error: "reconcile-ringcentral-voice failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/reconcile-ringcentral-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await run(request);
        } catch (error) {
          const message = error instanceof Error ? error.message : "sync failed";
          console.error(
            "[cron reconcile-ringcentral-voice]",
            message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 300),
          );
          return Response.json({ error: "reconcile-ringcentral-voice failed" }, { status: 500 });
        }
      },
    },
  },
});
