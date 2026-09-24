// Backstop so webhooks are never the only ingestion path: list leads straight
// from Meta and ingest any that Boltz does not hold. Bounded and idempotent.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { metaConfigError, requireMetaSecret } from "./env.server";
import { GraphError, listFormLeads, listForms } from "./graph.server";
import type { GraphLead } from "./normalize";
import { MAX_INGEST_ATTEMPTS, META_PROVIDER, ingestMetaLead } from "./ingest.server";

export type ReconcileWindow = "incremental" | "nightly";

/** Incremental overlaps several 10–15 minute runs so one missed run loses nothing. */
export const RECONCILE_LOOKBACK_MINUTES: Record<ReconcileWindow, number> = {
  incremental: 120,
  nightly: 7 * 24 * 60,
};
/** Meta keeps leads retrievable for 90 days. */
export const MAX_LOOKBACK_MINUTES = 90 * 24 * 60;
const MAX_INGEST_PER_RUN = 100;
const MAX_RETRIES_PER_RUN = 25;

export type ReconcileSummary = {
  window: ReconcileWindow;
  since: string;
  forms: number;
  scanned: number;
  missingDetected: number;
  notIngested: number;
  ingested: number;
  duplicates: number;
  failed: number;
  retried: number;
  truncated: boolean;
  errors: string[];
};

export async function reconcileMetaLeads(args: {
  window: ReconcileWindow;
  lookbackMinutes?: number | undefined;
}): Promise<ReconcileSummary> {
  const configError = metaConfigError();
  if (configError) throw new Error(configError);

  const minutes = Math.min(
    MAX_LOOKBACK_MINUTES,
    Math.max(1, args.lookbackMinutes ?? RECONCILE_LOOKBACK_MINUTES[args.window]),
  );
  const sinceMs = Date.now() - minutes * 60_000;
  const summary: ReconcileSummary = {
    window: args.window,
    since: new Date(sinceMs).toISOString(),
    forms: 0,
    scanned: 0,
    missingDetected: 0,
    notIngested: 0,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    retried: 0,
    truncated: false,
    errors: [],
  };

  try {
    const pageId = requireMetaSecret("META_PAGE_ID");
    const forms = await listForms(pageId);
    summary.forms = forms.length;

    const byId = new Map<string, GraphLead>();
    for (const form of forms) {
      try {
        const { leads, truncated } = await listFormLeads(form.id, Math.floor(sinceMs / 1000));
        summary.truncated ||= truncated;
        for (const lead of leads)
          if (lead.id) byId.set(lead.id, { ...lead, form_id: lead.form_id ?? form.id });
      } catch (error) {
        if (error instanceof GraphError && error.isAuthError) throw error;
        summary.errors.push(
          `form ${form.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    summary.scanned = byId.size;
    await recordHealth({
      provider: META_PROVIDER,
      checkName: "graph_fetch",
      ok: summary.errors.length === 0,
      detail: `reconciliation listed ${summary.scanned} leads across ${summary.forms} forms`,
    });

    const status = await existingStatus([...byId.keys()]);
    const toIngest: GraphLead[] = [];
    for (const [id, lead] of byId) {
      const current = status.get(id);
      if (current === "ingested") continue;
      if (current === undefined) summary.missingDetected += 1;
      else summary.notIngested += 1;
      toIngest.push(lead);
    }

    for (const lead of toIngest.slice(0, MAX_INGEST_PER_RUN)) {
      const outcome = await ingestMetaLead({
        metaLeadId: lead.id,
        method: "RECONCILIATION",
        prefetched: lead,
      });
      if (outcome.status === "ingested") summary.ingested += 1;
      else if (outcome.status === "duplicate") summary.duplicates += 1;
      else {
        summary.failed += 1;
        summary.errors.push(`lead ${lead.id}: ${outcome.error}`);
      }
    }
    if (toIngest.length > MAX_INGEST_PER_RUN) summary.truncated = true;

    // Receipts whose inline fetch failed and that fell outside the listing window.
    const { data: stuck } = await supabaseAdmin
      .from("meta_lead_submissions")
      .select("meta_lead_id")
      .in("ingest_status", ["received", "failed"])
      .lt("attempts", MAX_INGEST_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(MAX_RETRIES_PER_RUN);
    for (const row of stuck ?? []) {
      if (byId.has(row.meta_lead_id)) continue;
      summary.retried += 1;
      const outcome = await ingestMetaLead({
        metaLeadId: row.meta_lead_id,
        method: "RECONCILIATION",
      });
      if (outcome.status === "ingested") summary.ingested += 1;
      else if (outcome.status === "failed") summary.failed += 1;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    summary.errors.unshift(detail);
    if (error instanceof GraphError && error.isAuthError) {
      await recordHealth({ provider: META_PROVIDER, checkName: "token_auth", ok: false, detail });
    }
  }

  await recordHealth({
    provider: META_PROVIDER,
    checkName: `reconcile_${summary.window}`,
    ok: summary.errors.length === 0 && summary.failed === 0,
    detail:
      summary.errors[0]?.slice(0, 300) ??
      `scanned ${summary.scanned}, missing ${summary.missingDetected}, ingested ${summary.ingested}, duplicates ${summary.duplicates}`,
    metadata: { ...summary, errors: summary.errors.slice(0, 5) },
  });
  return summary;
}

async function existingStatus(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from("meta_lead_submissions")
      .select("meta_lead_id, ingest_status")
      .in("meta_lead_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) out.set(row.meta_lead_id, row.ingest_status);
  }
  return out;
}
