// Meta lead ingestion: durable receipt → Graph fetch → normalize → Boltz lead.
// Every entry point (webhook, reconciliation, manual import) funnels through
// ingestMetaLead, which is idempotent on the Meta lead id.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  addEvent,
  enqueueJob,
  getOrCreateLeadThread,
  recordHealth,
} from "@/server/lead-inbox/store.server";
import type { LeadRow } from "@/server/lead-inbox/store.server";
import { readMetaSecret } from "./env.server";
import { GraphError, getForm, getLead } from "./graph.server";
import {
  META_LEAD_SOURCE,
  buildConsentEvidence,
  fillBlankLeadFields,
  formSummary,
  normalizeFieldData,
  resolvePlatform,
} from "./normalize";
import type { GraphLead, LeadgenEvent } from "./normalize";
import { sha256Hex } from "./signature";

export type IngestionMethod = Database["public"]["Enums"]["lead_ingestion_method"];
export type MetaSubmissionRow = Database["public"]["Tables"]["meta_lead_submissions"]["Row"];

export const META_PROVIDER = "meta";
/** Receipts that keep failing stop being retried by reconciliation after this. */
export const MAX_INGEST_ATTEMPTS = 8;

/**
 * Step 1 of every path: persist that the lead exists before anything can fail.
 * Returns false when the row already existed (a replayed or reconciled lead).
 */
export async function recordReceipt(args: {
  metaLeadId: string;
  method: IngestionMethod;
  event?: LeadgenEvent | undefined;
  webhookPayload?: unknown;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("meta_lead_submissions")
    .upsert(
      {
        meta_lead_id: args.metaLeadId,
        ingestion_method: args.method,
        page_id: args.event?.pageId ?? null,
        form_id: args.event?.formId ?? null,
        ad_id: args.event?.adId ?? null,
        created_time: args.event?.createdTime ?? null,
        webhook_payload: (args.webhookPayload ?? null) as never,
        webhook_received_at: args.method === "WEBHOOK" ? new Date().toISOString() : null,
      },
      { onConflict: "meta_lead_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type IngestOutcome =
  | { status: "ingested"; leadId: string; created: boolean; submissionId: string }
  | { status: "duplicate"; leadId: string | null; submissionId: string }
  | { status: "failed"; error: string };

/**
 * Fetches (unless `prefetched`), normalizes and links one Meta lead. Safe to
 * call repeatedly and concurrently: the unique meta_lead_id row is the lock-free
 * dedupe key, lead matching is by phone/email, and the Grok job is keyed too.
 */
export async function ingestMetaLead(args: {
  metaLeadId: string;
  method: IngestionMethod;
  prefetched?: GraphLead | undefined;
  event?: LeadgenEvent | undefined;
}): Promise<IngestOutcome> {
  await recordReceipt({ metaLeadId: args.metaLeadId, method: args.method, event: args.event });

  const { data: row, error: rowError } = await supabaseAdmin
    .from("meta_lead_submissions")
    .select("*")
    .eq("meta_lead_id", args.metaLeadId)
    .single();
  if (rowError) throw rowError;
  if (row.ingest_status === "ingested") {
    return { status: "duplicate", leadId: row.lead_id, submissionId: row.id };
  }

  try {
    const graphLead = args.prefetched ?? (await getLead(args.metaLeadId));
    const fetchedAt = new Date().toISOString();
    if (!args.prefetched) {
      await recordHealth({
        provider: META_PROVIDER,
        checkName: "graph_fetch",
        ok: true,
        detail: "lead fetched",
      });
    }
    const formId = graphLead.form_id ?? row.form_id;
    const form = formId ? await getForm(formId).catch(() => null) : null;
    const platform = resolvePlatform(graphLead.platform);
    const normalized = normalizeFieldData(graphLead.field_data);
    const consent = buildConsentEvidence({ lead: graphLead, form, platform, nowIso: fetchedAt });
    const consentVersion = consent.consentText
      ? `form:${formId ?? "unknown"}:sha256:${(await sha256Hex(consent.consentText)).slice(0, 16)}`
      : null;

    const { lead, created } = await upsertBoltzLead({
      normalized,
      platform,
      metaLeadId: args.metaLeadId,
      formName: form?.name ?? null,
    });

    // Consent: record the evidence always; flip to opted_in only on an explicit
    // SMS checkbox, and never override a lead who opted out.
    if (consent.smsOptIn && lead.consent_status === "unknown") {
      await supabaseAdmin
        .from("leads")
        .update({
          consent_status: "opted_in",
          consent_updated_at: fetchedAt,
          consent_evidence: consent.evidence as never,
        })
        .eq("id", lead.id);
      await addEvent(
        lead.id,
        "consent_opted_in",
        "SMS consent checkbox checked on Meta Instant Form",
        "system",
        {
          meta_lead_id: args.metaLeadId,
          consent_version: consentVersion,
        },
      );
    }

    const { data: claimed, error: updateError } = await supabaseAdmin
      .from("meta_lead_submissions")
      .update({
        lead_id: lead.id,
        ingest_status: "ingested",
        platform,
        is_organic: graphLead.is_organic ?? null,
        page_id: row.page_id ?? readMetaSecret("META_PAGE_ID") ?? null,
        form_id: formId ?? null,
        form_name: form?.name ?? null,
        ad_id: graphLead.ad_id ?? row.ad_id,
        ad_name: graphLead.ad_name ?? null,
        adset_id: graphLead.adset_id ?? null,
        adset_name: graphLead.adset_name ?? null,
        campaign_id: graphLead.campaign_id ?? null,
        campaign_name: graphLead.campaign_name ?? null,
        created_time: graphLead.created_time
          ? new Date(graphLead.created_time).toISOString()
          : row.created_time,
        raw_field_data: (graphLead.field_data ?? []) as never,
        normalized_fields: normalized as never,
        consent_evidence: consent.evidence as never,
        consent_text: consent.consentText,
        consent_version: consentVersion,
        graph_fetched_at: fetchedAt,
        ingested_at: new Date().toISOString(),
        attempts: row.attempts + 1,
        last_error: null,
      })
      .eq("id", row.id)
      .neq("ingest_status", "ingested")
      .select("id");
    if (updateError) throw updateError;
    // A concurrent path (webhook vs reconciliation) finished first: stay silent.
    if ((claimed ?? []).length === 0) {
      return { status: "duplicate", leadId: lead.id, submissionId: row.id };
    }

    await addEvent(
      lead.id,
      "meta_lead_ingested",
      `${META_LEAD_SOURCE[platform]} submission ingested via ${args.method}`,
      "system",
      {
        meta_lead_id: args.metaLeadId,
        ingestion_method: args.method,
        form_id: formId ?? null,
        ad_id: graphLead.ad_id ?? null,
        campaign_id: graphLead.campaign_id ?? null,
        created_lead: created,
      },
    );

    // Grok runs only after the lead and its Meta record are durably stored.
    const job = await enqueueJob({
      jobType: "process_meta_lead",
      leadId: lead.id,
      inboundProviderMessageId: `meta:${args.metaLeadId}`,
      payload: { meta_lead_id: args.metaLeadId, submission_id: row.id },
    });
    if (job) {
      await supabaseAdmin
        .from("meta_lead_submissions")
        .update({ grok_enqueued_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    return { status: "ingested", leadId: lead.id, created, submissionId: row.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await supabaseAdmin
      .from("meta_lead_submissions")
      .update({
        ingest_status: "failed",
        attempts: row.attempts + 1,
        last_error: detail.slice(0, 600),
      })
      .eq("id", row.id)
      .neq("ingest_status", "ingested");
    await recordHealth({
      provider: META_PROVIDER,
      checkName:
        error instanceof GraphError ? (error.isAuthError ? "token_auth" : "graph_fetch") : "ingest",
      ok: false,
      detail,
      metadata: { meta_lead_id: args.metaLeadId, method: args.method },
    });
    return { status: "failed", error: detail };
  }
}

async function upsertBoltzLead(args: {
  normalized: ReturnType<typeof normalizeFieldData>;
  platform: ReturnType<typeof resolvePlatform>;
  metaLeadId: string;
  formName: string | null;
}): Promise<{ lead: LeadRow; created: boolean }> {
  const source = META_LEAD_SOURCE[args.platform];
  const { normalized } = args;
  let lead: LeadRow | null = null;
  let created = false;

  if (normalized.phone_e164) {
    const before = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("phone_e164", normalized.phone_e164)
      .maybeSingle();
    // Reuses the SMS inbox's lead+thread creation so a reply by text lands in
    // the same thread (and Grok's normal inbound handling applies).
    const result = await getOrCreateLeadThread(normalized.phone_e164, source);
    lead = result.lead;
    created = !before.data;
  } else if (normalized.email) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("email", normalized.email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    lead = data;
  }

  if (!lead) {
    const { data, error } = await supabaseAdmin
      .from("leads")
      .insert({ lead_source: source, lifecycle: "New", email: normalized.email })
      .select("*")
      .single();
    if (error) throw error;
    lead = data;
    created = true;
    await addEvent(lead.id, "lead_created", `Lead created from ${source}`, "system");
  }

  const updates = fillBlankLeadFields(lead as unknown as Record<string, unknown>, normalized);
  const summary = formSummary(normalized, args.formName);
  // Notes keep the whole submission readable; append rather than overwrite.
  const marker = `[meta:${args.metaLeadId}]`;
  if (!(lead.notes ?? "").includes(marker)) {
    updates["notes"] = [lead.notes, `${marker} ${summary}`]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8000);
  }
  if (!lead.lead_source) updates["lead_source"] = source;

  if (Object.keys(updates).length > 0) {
    const { data, error } = await supabaseAdmin
      .from("leads")
      .update(updates as never)
      .eq("id", lead.id)
      .select("*")
      .single();
    if (error) throw error;
    lead = data;
  }
  return { lead, created };
}

/** Webhook entry: durable receipt for every event, then a bounded inline attempt. */
export async function handleLeadgenEvents(
  events: LeadgenEvent[],
  payload: unknown,
): Promise<{
  received: number;
  ingested: number;
  duplicates: number;
  failed: number;
}> {
  const summary = { received: events.length, ingested: 0, duplicates: 0, failed: 0 };
  // Receipts first for the whole batch, so a slow Graph call cannot lose a lead.
  for (const event of events) {
    await recordReceipt({
      metaLeadId: event.leadgenId,
      method: "WEBHOOK",
      event,
      webhookPayload: payload,
    });
  }
  for (const event of events.slice(0, 5)) {
    const outcome = await ingestMetaLead({ metaLeadId: event.leadgenId, method: "WEBHOOK", event });
    if (outcome.status === "ingested") summary.ingested += 1;
    else if (outcome.status === "duplicate") summary.duplicates += 1;
    else summary.failed += 1;
  }
  return summary;
}
