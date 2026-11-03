// Meta lead mail that the Gmail poll already reads. Details go through the
// Meta ingest path (no Graph). A notice with no details triggers reconciliation
// once; a Graph denial is logged and does not fail the rest of intake.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { parseMetaLeadEmail } from "@/server/intake/parse-meta-email";
import { graphPartsFromInbound } from "./make-lead";
import type { InboundMetaLead } from "./make-lead";
import { ingestMetaLead } from "./ingest.server";
import { metaConfigError } from "./env.server";
import { reconcileMetaLeads } from "./reconcile.server";

const RECEIPT_SOURCE = "Meta lead email";

export type MetaEmailApply = {
  kind: "ignore" | "notice" | "leads";
  notices: number;
  leads: number;
  ingested: number;
  duplicates: number;
  failed: number;
  /** Caller reconciles once, then receipts the notice. */
  reconcile: boolean;
};

export async function applyMetaLeadEmail(args: {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  csvText: string | null;
  receivedAt: string | null;
  dryRun: boolean;
}): Promise<MetaEmailApply> {
  const parsed = parseMetaLeadEmail(args);
  if (parsed.kind === "ignore") {
    return empty("ignore");
  }
  if (args.dryRun) {
    return {
      kind: parsed.kind,
      notices: parsed.kind === "notice" ? 1 : 0,
      leads: parsed.kind === "leads" ? parsed.leads.length : 0,
      ingested: 0,
      duplicates: 0,
      failed: 0,
      reconcile: false,
    };
  }
  if (await receiptExists(args.messageId)) {
    return {
      kind: parsed.kind,
      notices: 0,
      leads: 0,
      ingested: 0,
      duplicates: parsed.kind === "leads" ? parsed.leads.length : 1,
      failed: 0,
      reconcile: false,
    };
  }
  if (parsed.kind === "notice") {
    return {
      kind: "notice",
      notices: 1,
      leads: 0,
      ingested: 0,
      duplicates: 0,
      failed: 0,
      reconcile: true,
    };
  }

  let ingested = 0;
  let duplicates = 0;
  let failed = 0;
  let leadId: string | null = null;
  for (const lead of parsed.leads) {
    const outcome = await ingestParsedEmailLead(lead);
    if (outcome.status === "ingested") {
      ingested += 1;
      leadId = outcome.leadId;
    } else if (outcome.status === "duplicate") {
      duplicates += 1;
      leadId = outcome.leadId ?? leadId;
    } else failed += 1;
  }
  if (failed === 0) {
    await insertReceipt({
      messageId: args.messageId,
      receivedAt: args.receivedAt,
      externalId: `meta-email:${args.messageId}`,
      leadId,
      status: ingested > 0 ? "ingested" : "duplicate",
    });
  }
  await recordHealth({
    provider: "meta",
    checkName: "email_lead",
    ok: failed === 0,
    detail: `email payload ingested ${ingested}, duplicates ${duplicates}, failed ${failed}`,
  });
  return {
    kind: "leads",
    notices: 0,
    leads: parsed.leads.length,
    ingested,
    duplicates,
    failed,
    reconcile: false,
  };
}

export async function receiptMetaLeadNotice(args: {
  messageId: string;
  receivedAt: string | null;
}): Promise<void> {
  await insertReceipt({
    messageId: args.messageId,
    receivedAt: args.receivedAt,
    externalId: `notice:${args.messageId}`,
    leadId: null,
    status: "skipped",
  });
}

/**
 * Same incremental reconciliation the cron runs. Graph permission errors stay
 * in the summary; this function does not throw.
 */
export async function reconcileMetaLeadsFromEmailNotice(): Promise<void> {
  try {
    const configError = metaConfigError();
    if (configError) {
      await recordHealth({
        provider: "meta",
        checkName: "email_notice",
        ok: false,
        detail: `notice-only Meta lead email; ${configError}`,
      });
      console.info("[meta email] notice-only; reconciliation skipped, Meta is not configured");
      return;
    }
    const summary = await reconcileMetaLeads({ window: "incremental" });
    const denied = summary.errors.length > 0 && summary.scanned === 0 && summary.ingested === 0;
    await recordHealth({
      provider: "meta",
      checkName: "email_notice",
      ok: summary.errors.length === 0 && summary.failed === 0,
      detail: denied
        ? "notice-only Meta lead email; reconciliation could not read leads"
        : `notice-only Meta lead email; reconciliation scanned ${summary.scanned}, ingested ${summary.ingested}`,
      metadata: {
        scanned: summary.scanned,
        ingested: summary.ingested,
        duplicates: summary.duplicates,
        failed: summary.failed,
        errors: summary.errors.slice(0, 5),
      },
    });
    console.info(
      `[meta email] notice-only; reconciliation scanned=${summary.scanned} ingested=${summary.ingested} failed=${summary.failed} errors=${summary.errors.length}`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : "reconciliation failed";
    await recordHealth({
      provider: "meta",
      checkName: "email_notice",
      ok: false,
      detail: `notice-only Meta lead email; ${detail}`,
    });
    console.info("[meta email] notice-only; reconciliation no-op");
  }
}

async function ingestParsedEmailLead(lead: InboundMetaLead) {
  const parts = graphPartsFromInbound(lead);
  return ingestMetaLead({
    metaLeadId: lead.metaLeadId,
    method: "EMAIL",
    skipGraph: true,
    prefetched: parts.lead,
    form: parts.form,
    pageId: lead.pageId ?? undefined,
    event: {
      leadgenId: lead.metaLeadId,
      pageId: lead.pageId,
      formId: lead.formId,
      adId: lead.adId,
      adgroupId: lead.adsetId,
      createdTime: lead.createdTime,
    },
  });
}

function empty(kind: "ignore"): MetaEmailApply {
  return {
    kind,
    notices: 0,
    leads: 0,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    reconcile: false,
  };
}

async function receiptExists(messageId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("email_intake_receipts")
    .select("id")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function insertReceipt(args: {
  messageId: string;
  receivedAt: string | null;
  externalId: string;
  leadId: string | null;
  status: "ingested" | "duplicate" | "skipped";
}): Promise<void> {
  const { error } = await supabaseAdmin.from("email_intake_receipts").insert({
    provider_message_id: args.messageId,
    source: RECEIPT_SOURCE,
    external_id: args.externalId,
    lead_id: args.leadId,
    status: args.status,
    received_at: args.receivedAt,
    suppress_first_touch: true,
  });
  if (error && error.code !== "23505") throw error;
}
