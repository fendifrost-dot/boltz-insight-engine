// Meta notification mail → existing Meta ingest, or an immediate reconcile
// when the message has no lead answers. Never sends SMS. A Graph denial is
// logged and swallowed so Yelp, Durable, and Google intake still finish.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { GmailMessage } from "./gmail.server";
import { metaEmailDedupeId } from "./parse-meta-email";
import type { ParsedMetaEmail } from "./parse-meta-email";

export async function metaEmailAlreadySeen(messageId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("email_intake_receipts")
    .select("id")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Stores the lead from the message itself. Does not call the Graph API. */
export async function ingestMetaEmailDetails(
  message: GmailMessage,
  parsed: ParsedMetaEmail,
): Promise<"ingested" | "duplicate" | "failed"> {
  const { ingestMetaLead } = await import("@/server/meta-leads/ingest.server");
  const metaLeadId = metaEmailDedupeId(parsed, message.messageId);
  const outcome = await ingestMetaLead({
    metaLeadId,
    method: "EMAIL",
    prefetched: {
      id: metaLeadId,
      ...(message.receivedAt ? { created_time: message.receivedAt } : {}),
      field_data: parsed.fieldData,
      ...(parsed.formId ? { form_id: parsed.formId } : {}),
      ...(parsed.adId ? { ad_id: parsed.adId } : {}),
      ...(parsed.adName ? { ad_name: parsed.adName } : {}),
      ...(parsed.campaignId ? { campaign_id: parsed.campaignId } : {}),
      ...(parsed.campaignName ? { campaign_name: parsed.campaignName } : {}),
      platform: parsed.platform === "instagram" ? "ig" : "fb",
    },
    pageId: parsed.pageId ?? undefined,
    formName: parsed.formName,
    skipGraph: true,
    suppressFirstTouch: true,
    suppressNote: "First touch suppressed for a Meta lead read from email",
  });
  if (outcome.status === "failed") return "failed";
  await insertReceipt({
    message,
    externalId: `meta:${metaLeadId}`,
    leadId: outcome.leadId,
    status: outcome.status === "duplicate" ? "duplicate" : "ingested",
  });
  return outcome.status === "duplicate" ? "duplicate" : "ingested";
}

export async function recordMetaLeadNotice(message: GmailMessage): Promise<void> {
  await insertReceipt({
    message,
    externalId: `meta-notice:${message.messageId}`,
    leadId: null,
    status: "skipped",
  });
}

/**
 * Runs the same incremental reconcile the cron uses. Permission errors and a
 * missing Meta config are recorded and do not throw.
 */
export async function triggerMetaLeadReconcileFromEmail(): Promise<void> {
  try {
    const { reconcileMetaLeads } = await import("@/server/meta-leads/reconcile.server");
    const summary = await reconcileMetaLeads({ window: "incremental" });
    const detail = (
      summary.errors[0] ??
      `email notice triggered reconcile; scanned ${summary.scanned}, ingested ${summary.ingested}`
    ).slice(0, 300);
    const ok = summary.errors.length === 0 && summary.failed === 0;
    console.info(
      `[meta email] notice reconcile ok=${ok} scanned=${summary.scanned} ingested=${summary.ingested} errors=${summary.errors.length}`,
    );
    await recordReconcileHealth(ok, detail);
  } catch (error) {
    const detail = (error instanceof Error ? error.message : "reconcile failed")
      .replace(/\+?\d{7,}/g, "[redacted]")
      .slice(0, 300);
    console.info(`[meta email] notice reconcile failed: ${detail}`);
    try {
      await recordReconcileHealth(false, detail);
    } catch {
      // A health-log failure must not fail the mailbox poll.
    }
  }
}

async function recordReconcileHealth(ok: boolean, detail: string): Promise<void> {
  const { recordHealth } = await import("@/server/lead-inbox/store.server");
  await recordHealth({
    provider: "meta",
    checkName: "email_notice_reconcile",
    ok,
    detail,
  });
}

async function insertReceipt(args: {
  message: GmailMessage;
  externalId: string | null;
  leadId: string | null;
  status: "ingested" | "duplicate" | "skipped";
}): Promise<void> {
  const row = {
    provider_message_id: args.message.messageId,
    source: "Meta Lead Ads",
    external_id: args.externalId,
    lead_id: args.leadId,
    status: args.status,
    received_at: args.message.receivedAt,
    suppress_first_touch: true,
  };
  const { error } = await supabaseAdmin.from("email_intake_receipts").insert(row);
  if (!error) return;
  if (error.code !== "23505") throw error;
  if (!args.externalId) return;
  const retry = await supabaseAdmin.from("email_intake_receipts").insert({
    ...row,
    external_id: null,
  });
  if (retry.error && retry.error.code !== "23505") throw retry.error;
}
