// Make.com Facebook Lead Ads → Insight Engine. Public prefix; bearer-authed here.
// Does not call Meta Graph. Dedupe is the existing meta_lead_id unique key.
import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY = 200_000;

async function receive(request: Request): Promise<Response> {
  const { authorizeMakeLeadIntake, readMakeLeadIntakeSecret } =
    await import("@/server/meta-leads/make-lead");
  const denied = authorizeMakeLeadIntake(
    request.headers.get("authorization"),
    readMakeLeadIntakeSecret(),
  );
  if (denied) return denied;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { graphPartsFromInbound, parseMakeLeadBody } =
    await import("@/server/meta-leads/make-lead");
  const parsed = parseMakeLeadBody(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { ingestMetaLead } = await import("@/server/meta-leads/ingest.server");
  const parts = graphPartsFromInbound(parsed.lead);
  const outcome = await ingestMetaLead({
    metaLeadId: parsed.lead.metaLeadId,
    method: "MAKE",
    skipGraph: true,
    prefetched: parts.lead,
    form: parts.form,
    pageId: parsed.lead.pageId ?? undefined,
    event: {
      leadgenId: parsed.lead.metaLeadId,
      pageId: parsed.lead.pageId,
      formId: parsed.lead.formId,
      adId: parsed.lead.adId,
      adgroupId: parsed.lead.adsetId,
      createdTime: parsed.lead.createdTime,
    },
    receiptPayload: body,
  });
  if (outcome.status === "failed") {
    return Response.json({ error: "make lead ingest failed" }, { status: 500 });
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
          return Response.json({ error: "make lead ingest failed" }, { status: 500 });
        }
      },
    },
  },
});
