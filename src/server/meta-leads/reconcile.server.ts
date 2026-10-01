// Backstop so webhooks are never the only ingestion path: list leads straight
// from Meta and ingest any that Boltz does not hold. Bounded and idempotent.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { configuredLeadgenPageIds, metaConfigError } from "./env.server";
import {
  GraphError,
  countFormLeads,
  listFormLeads,
  listFormQuestionKeys,
  listForms,
  pageAccessTokenFor,
} from "./graph.server";
import type { GraphLead } from "./normalize";
import { leadgenPagesToScan } from "./pages";
import type { LeadgenPage } from "./pages";
import { MAX_INGEST_ATTEMPTS, META_PROVIDER, ingestMetaLead } from "./ingest.server";

export type ReconcileWindow = "incremental" | "nightly" | "backfill";

/** Incremental overlaps several 10–15 minute runs so one missed run loses nothing. */
export const RECONCILE_LOOKBACK_MINUTES: Record<"incremental" | "nightly", number> = {
  incremental: 120,
  nightly: 7 * 24 * 60,
};
/** Meta keeps leads retrievable for 90 days. */
export const MAX_LOOKBACK_MINUTES = 90 * 24 * 60;
const MAX_INGEST_PER_RUN = 100;
const MAX_BACKFILL_INGEST = 500;
const MAX_RETRIES_PER_RUN = 25;

export type FormStat = {
  pageId: string;
  formId: string;
  leads: number;
};

export type ReconcileSummary = {
  window: ReconcileWindow;
  since: string;
  pages: LeadgenPage[];
  forms: number;
  formStats: FormStat[];
  scanned: number;
  missingDetected: number;
  notIngested: number;
  ingested: number;
  duplicates: number;
  failed: number;
  retried: number;
  truncated: boolean;
  contactedMatched: number;
  contactedIgnored: number;
  errors: string[];
};

export async function reconcileMetaLeads(args: {
  window: ReconcileWindow;
  lookbackMinutes?: number | undefined;
  sinceMs?: number | undefined;
  /** Graph `time_created` GREATER_THAN bound. Backfill passes an inclusive instant. */
  sinceUnix?: number | undefined;
  /** Backfill only. Never enqueue a first-touch job for leads in this run. */
  suppressFirstTouch?: boolean | undefined;
  /** E.164 set. Compared in memory; not stored and not logged. */
  contactedPhones?: ReadonlySet<string> | undefined;
  contactedIgnored?: number | undefined;
}): Promise<ReconcileSummary> {
  const configError = metaConfigError();
  if (configError) throw new Error(configError);

  const sinceMs =
    args.sinceMs ??
    Date.now() -
      Math.min(
        MAX_LOOKBACK_MINUTES,
        Math.max(
          1,
          args.lookbackMinutes ??
            RECONCILE_LOOKBACK_MINUTES[args.window === "backfill" ? "nightly" : args.window],
        ),
      ) *
        60_000;
  const summary: ReconcileSummary = {
    window: args.window,
    since: new Date(sinceMs).toISOString(),
    pages: [],
    forms: 0,
    formStats: [],
    scanned: 0,
    missingDetected: 0,
    notIngested: 0,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    retried: 0,
    truncated: false,
    contactedMatched: 0,
    contactedIgnored: args.contactedIgnored ?? 0,
    errors: [],
  };
  const maxIngest = args.window === "backfill" ? MAX_BACKFILL_INGEST : MAX_INGEST_PER_RUN;

  try {
    const pages = leadgenPagesToScan(configuredLeadgenPageIds());
    summary.pages = pages;
    const byId = new Map<string, { lead: GraphLead; pageId: string }>();

    for (const page of pages) {
      let forms: { id: string }[] = [];
      let pageToken: string | undefined;
      try {
        pageToken = (await pageAccessTokenFor(page.pageId)).token;
        const listed = await listForms(page.pageId);
        forms = listed.forms;
        summary.truncated ||= listed.truncated;
        if (listed.truncated) summary.errors.push(`page ${page.pageId}: form list truncated`);
      } catch (error) {
        if (error instanceof GraphError && error.isAuthError) throw error;
        summary.errors.push(`page ${page.pageId}: ${graphErrorCode(error)}`);
        continue;
      }

      for (const form of forms) {
        try {
          const { leads, truncated } = await listFormLeads(
            form.id,
            args.sinceUnix ?? Math.floor(sinceMs / 1000),
            10,
            pageToken,
          );
          summary.truncated ||= truncated;
          summary.formStats.push({ pageId: page.pageId, formId: form.id, leads: leads.length });
          for (const lead of leads) {
            if (!lead.id || byId.has(lead.id)) continue;
            byId.set(lead.id, {
              lead: { ...lead, form_id: lead.form_id ?? form.id },
              pageId: page.pageId,
            });
          }
        } catch (error) {
          if (error instanceof GraphError && error.isAuthError) throw error;
          summary.errors.push(`form ${form.id}: ${graphErrorCode(error)}`);
        }
      }
    }

    summary.forms = new Set(summary.formStats.map((stat) => stat.formId)).size;
    await recordHealth({
      provider: META_PROVIDER,
      checkName: "graph_fetch",
      ok: summary.errors.length === 0,
      detail: `reconciliation listed ${byId.size} leads across ${summary.forms} forms`,
      metadata: {
        forms: summary.forms,
        formStats: summary.formStats.slice(0, 100),
        pages: summary.pages,
      },
    });

    const status = await existingStatus([...byId.keys()]);
    const toIngest: { lead: GraphLead; pageId: string }[] = [];
    for (const [id, entry] of byId) {
      const current = status.get(id);
      if (current === "ingested" && !args.suppressFirstTouch) continue;
      if (current === undefined) summary.missingDetected += 1;
      else if (current !== "ingested") summary.notIngested += 1;
      toIngest.push(entry);
    }
    // New leads before already-ingested rows, so a cap cannot skip them.
    toIngest.sort((a, b) => {
      const rank = (id: string) => (status.get(id) === "ingested" ? 1 : 0);
      return rank(a.lead.id) - rank(b.lead.id);
    });
    summary.scanned = byId.size;

    for (const entry of toIngest.slice(0, maxIngest)) {
      const outcome = await ingestMetaLead({
        metaLeadId: entry.lead.id,
        method: "RECONCILIATION",
        prefetched: entry.lead,
        pageId: entry.pageId,
        suppressFirstTouch: args.suppressFirstTouch === true,
        contactedPhones: args.contactedPhones,
      });
      if (outcome.status === "ingested") summary.ingested += 1;
      else if (outcome.status === "duplicate") summary.duplicates += 1;
      else {
        summary.failed += 1;
        summary.errors.push(`lead ${entry.lead.id}: ${graphErrorCode(outcome.error)}`);
      }
      if (outcome.alreadyContacted) summary.contactedMatched += 1;
    }
    if (toIngest.length > maxIngest) summary.truncated = true;

    // Receipts whose inline fetch failed and that fell outside the listing window.
    // Backfill still suppresses first touch on these retries.
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
        suppressFirstTouch: args.suppressFirstTouch === true,
        contactedPhones: args.contactedPhones,
      });
      if (outcome.status === "ingested") summary.ingested += 1;
      else if (outcome.status === "failed") summary.failed += 1;
      if (outcome.alreadyContacted) summary.contactedMatched += 1;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    summary.errors.unshift(
      graphErrorCode(error) === "HTTP error" ? detail.slice(0, 300) : graphErrorCode(error),
    );
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
      `forms ${summary.forms}, scanned ${summary.scanned}, missing ${summary.missingDetected}, ingested ${summary.ingested}, duplicates ${summary.duplicates}`,
    metadata: {
      ...summary,
      errors: summary.errors.slice(0, 5),
      formStats: summary.formStats.slice(0, 100),
    },
  });
  return summary;
}

export type DiagnoseForm = {
  pageId: string;
  formId: string;
  status: string | null;
  questionKeys: string[];
  leadsCount: number | null;
  leadsInWindow: number | null;
  truncated: boolean;
  questionsError: string | null;
};

export type DiagnoseReport = {
  mode: "diagnose";
  since: string | null;
  pages: LeadgenPage[];
  formCount: number;
  forms: DiagnoseForm[];
  errors: string[];
};

/** Read-only: form ids, owning page, question keys, and counts. No lead answers. */
export async function diagnoseMetaLeadForms(args: {
  sinceUnix?: number | undefined;
  sinceIso?: string | undefined;
}): Promise<DiagnoseReport> {
  const configError = metaConfigError();
  if (configError) throw new Error(configError);

  const pages = leadgenPagesToScan(configuredLeadgenPageIds());
  const forms: DiagnoseForm[] = [];
  const errors: string[] = [];

  for (const page of pages) {
    try {
      const token = (await pageAccessTokenFor(page.pageId)).token;
      const listed = await listForms(page.pageId);
      if (listed.truncated) errors.push(`page ${page.pageId}: form list truncated`);
      for (const form of listed.forms) {
        let questionKeys: string[] = [];
        let questionsError: string | null = null;
        try {
          questionKeys = await listFormQuestionKeys(form.id, token);
        } catch (error) {
          if (error instanceof GraphError && error.isAuthError) throw error;
          questionsError = graphErrorCode(error);
        }
        let leadsInWindow: number | null = null;
        let truncated = listed.truncated;
        if (args.sinceUnix !== undefined) {
          try {
            const counted = await countFormLeads(form.id, args.sinceUnix, token);
            leadsInWindow = counted.count;
            truncated ||= counted.truncated;
          } catch (error) {
            if (error instanceof GraphError && error.isAuthError) throw error;
            errors.push(`form ${form.id}: ${graphErrorCode(error)}`);
          }
        }
        forms.push({
          pageId: page.pageId,
          formId: form.id,
          status: form.status ?? null,
          questionKeys,
          leadsCount: form.leadsCount,
          leadsInWindow,
          truncated,
          questionsError,
        });
      }
    } catch (error) {
      if (error instanceof GraphError && error.isAuthError) {
        errors.push(`page ${page.pageId}: ${graphErrorCode(error)}`);
        break;
      }
      errors.push(`page ${page.pageId}: ${graphErrorCode(error)}`);
    }
  }

  const report: DiagnoseReport = {
    mode: "diagnose",
    since: args.sinceIso ?? null,
    pages,
    formCount: new Set(forms.map((form) => form.formId)).size,
    forms,
    errors,
  };
  await recordHealth({
    provider: META_PROVIDER,
    checkName: "leadgen_forms",
    ok: errors.length === 0,
    detail: `${report.formCount} forms`,
    metadata: {
      forms: report.formCount,
      formStats: forms.slice(0, 100).map((form) => ({
        pageId: form.pageId,
        formId: form.formId,
        leads: form.leadsInWindow ?? form.leadsCount ?? 0,
      })),
      pages,
    },
  });
  return report;
}

function graphErrorCode(error: unknown): string {
  if (error instanceof GraphError) {
    return `HTTP ${error.status}${error.code !== null ? ` code ${error.code}` : ""}`;
  }
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const code = /code (\d+)/.exec(text);
  const status = /\((\d{3})/.exec(text);
  if (code) return `HTTP ${status?.[1] ?? "?"}${` code ${code[1]}`}`;
  if (/suppress_first_touch/.test(text)) return "missing column suppress_first_touch";
  return "ingest failed";
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
