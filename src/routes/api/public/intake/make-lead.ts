// Make.com Facebook Lead Ads fallback. Public prefix; bearer-authenticated
// in-handler against MAKE_LEAD_INTAKE_SECRET. Does not call the Graph API
// and does not send SMS. Dedupe is the existing meta_lead_id unique row.
import { createFileRoute } from "@tanstack/react-router";

async function receive(request: Request): Promise<Response> {
  const { authorizeMakeIntake } = await import("@/server/meta-leads/make-auth");
  const denied = authorizeMakeIntake(request);
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { parseMakeLeadPayload } = await import("@/server/meta-leads/make-payload");
  const parsed = parseMakeLeadPayload(payload);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const { ingestMetaLead } = await import("@/server/meta-leads/ingest.server");
  const outcome = await ingestMetaLead({
    metaLeadId: parsed.metaLeadId,
    method: "MAKE",
    prefetched: parsed.lead,
    pageId: parsed.pageId ?? undefined,
    formName: parsed.formName,
    skipGraph: true,
  });

  if (outcome.status === "failed") {
    return Response.json({ ok: false, lead_id: null, duplicate: false }, { status: 502 });
  }
  return Response.json(
    {
      ok: true,
      lead_id: outcome.leadId,
      duplicate: outcome.status === "duplicate",
    },
    { status: 200 },
  );
}

export const Route = createFileRoute("/api/public/intake/make-lead")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await receive(request);
        } catch (error) {
          console.error(
            "[make lead intake]",
            error instanceof Error
              ? error.message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200)
              : "failed",
          );
          return Response.json({ error: "make lead intake failed" }, { status: 500 });
        }
      },
    },
  },
});
