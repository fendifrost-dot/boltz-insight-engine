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
import { GraphError, getForm, getLead, pageAccessTokenFor } from "./graph.server";
import {
  META_LEAD_SOURCE,
  buildConsentEvidence,
  enqueuesFirstTouch,
  fillBlankLeadFields,
  formSummary,
  normalizeFieldData,
  normalizePhone,
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
  pageId?: string | undefined;
  webhookPayload?: unknown;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("meta_lead_submissions")
    .upsert(
      {
        meta_lead_id: args.metaLeadId,
        ingestion_method: args.method,
        page_id: args.event?.pageId ?? args.pageId ?? null,
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
  | {
      status: "ingested";
      leadId: string;
      created: boolean;
      submissionId: string;
      alreadyContacted: boolean;
    }
  | { status: "duplicate"; leadId: string | null; submissionId: string; alreadyContacted: boolean }
  | { status: "failed"; error: string; alreadyContacted: false };

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
  /** Page that owns the form. Stored on the row; used to read that Page's token. */
  pageId?: string | undefined;
  /**
   * Backfill sets this. The lead is stored and deduped, and no `message_jobs`
   * row is enqueued. `suppress_first_touch` blocks a later job from sending.
   * Ingest also sets the flag when `enqueuesFirstTouch` refuses the lead.
   */
  suppressFirstTouch?: boolean | undefined;
  /** E.164 numbers, compared in memory. Never log this set. */
  contactedPhones?: ReadonlySet<string> | undefined;
}): Promise<IngestOutcome> {
  await recordReceipt({
    metaLeadId: args.metaLeadId,
    method: args.method,
    event: args.event,
    pageId: args.pageId,
  });

  const { data: row, error: rowError } = await supabaseAdmin
    .from("meta_lead_submissions")
    .select("*")
    .eq("meta_lead_id", args.metaLeadId)
    .single();
  if (rowError) throw rowError;
  if (row.ingest_status === "ingested") {
    const alreadyContacted = await maybeApplyBackfillMarkers({
      submissionId: row.id,
      leadId: row.lead_id,
      metaLeadId: args.metaLeadId,
      alreadySuppressed: row.suppress_first_touch === true,
      suppressFirstTouch: args.suppressFirstTouch === true,
      contactedPhones: args.contactedPhones,
    });
    return { status: "duplicate", leadId: row.lead_id, submissionId: row.id, alreadyContacted };
  }

  try {
    const pageId = args.pageId ?? args.event?.pageId ?? undefined;
    const token = pageId ? (await pageAccessTokenFor(pageId)).token : undefined;
    const graphLead = args.prefetched ?? (await getLead(args.metaLeadId, token));
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
    const form = formId ? await getForm(formId, token).catch(() => null) : null;
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

    const createdTime =
      graphLead.created_time ?? row.created_time ?? args.event?.createdTime ?? null;
    // Backfill, the pre-cutoff backlog, and a reconciliation lead older than
    // 2 hours all store the row and never enqueue a first touch.
    const suppressFirstTouch =
      args.suppressFirstTouch === true ||
      !enqueuesFirstTouch({
        method: args.method,
        createdTime,
        nowMs: Date.parse(fetchedAt),
      });

    const { data: claimed, error: updateError } = await supabaseAdmin
      .from("meta_lead_submissions")
      .update({
        lead_id: lead.id,
        ingest_status: "ingested",
        platform,
        is_organic: graphLead.is_organic ?? null,
        page_id: row.page_id ?? pageId ?? readMetaSecret("META_PAGE_ID") ?? null,
        ...(suppressFirstTouch ? { suppress_first_touch: true } : {}),
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
      const alreadyContacted = await maybeApplyBackfillMarkers({
        submissionId: row.id,
        leadId: lead.id,
        metaLeadId: args.metaLeadId,
        alreadySuppressed: row.suppress_first_touch === true,
        suppressFirstTouch,
        contactedPhones: args.contactedPhones,
        phone: lead.phone_e164,
      });
      return { status: "duplicate", leadId: lead.id, submissionId: row.id, alreadyContacted };
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

    if (suppressFirstTouch) {
      await addEvent(
        lead.id,
        "meta_first_touch_suppressed",
        args.suppressFirstTouch
          ? "First touch suppressed for backfilled Meta lead"
          : "First touch suppressed because the Meta lead is outside the first-touch window",
        "system",
        { meta_lead_id: args.metaLeadId },
      );
    }

    const alreadyContacted = matchesContacted(lead.phone_e164, args.contactedPhones);
    if (alreadyContacted) await markAlreadyContacted(lead.id, args.metaLeadId);

    // Grok runs only after the lead and its Meta record are durably stored.
    // Backfill and out-of-window leads never enqueue, so process-jobs cannot
    // send a first touch. The flag is written in the same update, above.
    if (!suppressFirstTouch) {
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
    }

    return { status: "ingested", leadId: lead.id, created, submissionId: row.id, alreadyContacted };
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
    return { status: "failed", error: detail, alreadyContacted: false };
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

function matchesContacted(
  phone: string | null | undefined,
  contacted: ReadonlySet<string> | undefined,
): boolean {
  if (!phone || !contacted || contacted.size === 0) return false;
  const e164 = normalizePhone(phone);
  return Boolean(e164 && contacted.has(e164));
}

async function phoneForLead(leadId: string | null): Promise<string | null> {
  if (!leadId) return null;
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("phone_e164")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return data?.phone_e164 ?? null;
}

/** Stamps blank message timestamps. Does not write a message or the phone number. */
async function markAlreadyContacted(leadId: string, metaLeadId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: lead, error } = await supabaseAdmin
    .from("leads")
    .select("id, last_message_at, last_outbound_at")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!lead) return;
  const updates: { last_message_at?: string; last_outbound_at?: string } = {};
  if (!lead.last_message_at) updates.last_message_at = now;
  if (!lead.last_outbound_at) updates.last_outbound_at = now;
  if (Object.keys(updates).length === 0) return;
  const { error: updateError } = await supabaseAdmin.from("leads").update(updates).eq("id", leadId);
  if (updateError) throw updateError;
  await supabaseAdmin
    .from("message_threads")
    .update({ last_message_at: now })
    .eq("lead_id", leadId)
    .is("last_message_at", null);
  await addEvent(
    leadId,
    "meta_backfill_already_contacted",
    "Marked already contacted during Meta backfill",
    "system",
    {
      meta_lead_id: metaLeadId,
    },
  );
}

async function maybeApplyBackfillMarkers(args: {
  submissionId: string;
  leadId: string | null;
  metaLeadId: string;
  alreadySuppressed: boolean;
  suppressFirstTouch: boolean;
  contactedPhones: ReadonlySet<string> | undefined;
  phone?: string | null;
}): Promise<boolean> {
  const marking = args.suppressFirstTouch || (args.contactedPhones?.size ?? 0) > 0;
  if (!marking) return false;
  return applyBackfillMarkers(args);
}

async function applyBackfillMarkers(args: {
  submissionId: string;
  leadId: string | null;
  metaLeadId: string;
  alreadySuppressed: boolean;
  suppressFirstTouch: boolean;
  contactedPhones: ReadonlySet<string> | undefined;
  phone?: string | null;
}): Promise<boolean> {
  if (args.suppressFirstTouch && !args.alreadySuppressed) {
    const { error } = await supabaseAdmin
      .from("meta_lead_submissions")
      .update({ suppress_first_touch: true })
      .eq("id", args.submissionId);
    if (error) throw error;
    if (args.leadId) {
      await addEvent(
        args.leadId,
        "meta_first_touch_suppressed",
        "First touch suppressed for backfilled Meta lead",
        "system",
        { meta_lead_id: args.metaLeadId },
      );
    }
  }
  const phone = args.phone !== undefined ? args.phone : await phoneForLead(args.leadId);
  if (!matchesContacted(phone, args.contactedPhones) || !args.leadId) return false;
  await markAlreadyContacted(args.leadId, args.metaLeadId);
  return true;
}
