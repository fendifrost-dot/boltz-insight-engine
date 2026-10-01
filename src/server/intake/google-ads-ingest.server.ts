// Polls Google Ads lead-form submissions with the existing ads credentials.
// Writes leads only. Does not mutate the ads account and does not message anyone.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { adsSearch } from "@/server/google-ads/client.server";
import { adsConfigError } from "@/server/google-ads/env.server";
import { addEvent } from "@/server/lead-inbox/store.server";
import { googleAdsLeadQuery, mapAdsLeadSubmission, sinceDayUtc } from "./google-ads-leads";
import type { AdsLeadSubmissionRow, MappedAdsLead } from "./google-ads-leads";
import { toValidE164 } from "./parse-email";

export type GoogleAdsIntakeSummary = {
  configured: boolean;
  dryRun: boolean;
  since: string;
  scanned: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  failed: number;
  error: string | null;
};

export async function ingestGoogleAdsLeads(args: {
  sinceMs: number;
  dryRun: boolean;
}): Promise<GoogleAdsIntakeSummary> {
  const summary: GoogleAdsIntakeSummary = {
    configured: true,
    dryRun: args.dryRun,
    since: new Date(args.sinceMs).toISOString(),
    scanned: 0,
    ingested: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    error: null,
  };
  const configError = adsConfigError();
  if (configError) {
    summary.configured = false;
    summary.error = configError;
    return summary;
  }

  let rows: AdsLeadSubmissionRow[];
  try {
    rows = await adsSearch<AdsLeadSubmissionRow>(googleAdsLeadQuery(sinceDayUtc(args.sinceMs)));
  } catch (error) {
    summary.error = error instanceof Error ? error.message.slice(0, 300) : "Google Ads lead query failed";
    return summary;
  }

  const sinceMs = args.sinceMs;
  for (const row of rows) {
    const mapped = mapAdsLeadSubmission(row);
    if (!mapped) continue;
    if (mapped.submittedAt && Date.parse(mapped.submittedAt) < sinceMs) continue;
    summary.scanned += 1;
    if (args.dryRun) continue;
    try {
      const outcome = await writeAdsLead(mapped);
      if (outcome === "ingested") summary.ingested += 1;
      else if (outcome === "duplicate") summary.duplicates += 1;
      else summary.skipped += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function writeAdsLead(mapped: MappedAdsLead): Promise<"ingested" | "duplicate" | "skipped"> {
  const prior = await supabaseAdmin
    .from("email_intake_receipts")
    .select("id")
    .eq("provider_message_id", mapped.externalId)
    .maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) return "duplicate";

  const phone = toValidE164(mapped.phoneRaw);
  let leadId: string | null = null;
  if (phone) {
    const existing = await supabaseAdmin
      .from("leads")
      .select("id, consent_status, lead_source")
      .eq("phone_e164", phone)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.consent_status === "opted_out") {
      await supabaseAdmin.from("email_intake_receipts").insert({
        provider_message_id: mapped.externalId,
        source: "Google Ads",
        external_id: mapped.externalId,
        lead_id: existing.data.id,
        status: "skipped",
        received_at: mapped.submittedAt,
        suppress_first_touch: true,
      });
      await addEvent(
        existing.data.id,
        "intake_opt_out_respected",
        "Google Ads form matched an opted-out lead; no message sent",
        "system",
        { external_id: mapped.externalId, suppress_first_touch: true },
      );
      return "skipped";
    }
    if (existing.data) leadId = existing.data.id;
  }

  if (!leadId) {
    const inserted = await supabaseAdmin
      .from("leads")
      .insert({
        lead_source: "Google Ads",
        lifecycle: "New",
        name: mapped.name,
        email: mapped.email,
        phone_e164: phone,
        symptoms: mapped.symptoms,
        ...(mapped.submittedAt ? { created_at: mapped.submittedAt } : {}),
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    leadId = inserted.data.id;
    await addEvent(leadId, "lead_created", "Lead created from Google Ads", "system", {
      external_id: mapped.externalId,
      suppress_first_touch: true,
    });
  } else {
    await addEvent(leadId, "email_intake_attached", "Attached a Google Ads form to an existing lead", "system", {
      external_id: mapped.externalId,
      suppress_first_touch: true,
    });
  }

  const receipt = await supabaseAdmin.from("email_intake_receipts").insert({
    provider_message_id: mapped.externalId,
    source: "Google Ads",
    external_id: mapped.externalId,
    lead_id: leadId,
    status: "ingested",
    received_at: mapped.submittedAt,
    suppress_first_touch: true,
  });
  if (receipt.error && receipt.error.code !== "23505") throw receipt.error;
  return "ingested";
}
