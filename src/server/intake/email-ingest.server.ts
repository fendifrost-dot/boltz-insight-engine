// Writes parsed notification emails into public.leads. Never enqueues a job
// and never sends SMS or email. Receipts make a replay a no-op.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addEvent } from "@/server/lead-inbox/store.server";
import { gmailLeadQuery } from "./gmail-query";
import { gmailConfigError, listGmailLeadMessages } from "./gmail.server";
import type { GmailMessage } from "./gmail.server";
import { parseInboundEmail, toValidE164 } from "./parse-email";
import type { EmailLeadSource, ParsedEmailLead } from "./parse-email";

export type EmailIntakeMode = "incremental" | "backfill" | "dry-run";

export type EmailIntakeSummary = {
  configured: boolean;
  mode: EmailIntakeMode;
  since: string;
  scanned: number;
  parsed: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  failed: number;
  truncated: boolean;
  bySource: Record<EmailLeadSource, number>;
  error: string | null;
};

const EMPTY_BY_SOURCE: Record<EmailLeadSource, number> = {
  Yelp: 0,
  "Durable website": 0,
  "Google LSA": 0,
  "Google Business Profile": 0,
  "Google Ads": 0,
};

export async function ingestEmailLeads(args: {
  mode: EmailIntakeMode;
  sinceMs: number;
}): Promise<EmailIntakeSummary> {
  const summary: EmailIntakeSummary = {
    configured: true,
    mode: args.mode,
    since: new Date(args.sinceMs).toISOString(),
    scanned: 0,
    parsed: 0,
    ingested: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    truncated: false,
    bySource: { ...EMPTY_BY_SOURCE },
    error: null,
  };
  const configError = gmailConfigError();
  if (configError) {
    summary.configured = false;
    summary.error = configError;
    return summary;
  }

  const listed = await listGmailLeadMessages({
    query: gmailLeadQuery(args.sinceMs),
    maxPages: args.mode === "incremental" ? 2 : 8,
  });
  summary.truncated = listed.truncated;
  const inWindow = listed.messages.filter(
    (message) => message.receivedMs === null || message.receivedMs >= args.sinceMs,
  );
  summary.scanned = inWindow.length;

  for (const message of inWindow) {
    const parsed = parseInboundEmail({
      from: message.from,
      subject: message.subject,
      body: message.body,
      messageId: message.messageId,
      receivedAt: message.receivedAt,
    });
    if (!parsed) continue;
    summary.parsed += 1;
    summary.bySource[parsed.source] += 1;
    if (args.mode === "dry-run") continue;
    try {
      const outcome = await writeParsedLead(message, parsed);
      if (outcome === "ingested") summary.ingested += 1;
      else if (outcome === "duplicate") summary.duplicates += 1;
      else summary.skipped += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function writeParsedLead(
  message: GmailMessage,
  parsed: ParsedEmailLead,
): Promise<"ingested" | "duplicate" | "skipped" | "failed"> {
  const byMessage = await supabaseAdmin
    .from("email_intake_receipts")
    .select("id")
    .eq("provider_message_id", message.messageId)
    .maybeSingle();
  if (byMessage.error) throw byMessage.error;
  if (byMessage.data) return "duplicate";
  const byExternal = await supabaseAdmin
    .from("email_intake_receipts")
    .select("id")
    .eq("source", parsed.source)
    .eq("external_id", parsed.externalId)
    .maybeSingle();
  if (byExternal.error) throw byExternal.error;
  if (byExternal.data) return "duplicate";

  const phone = toValidE164(parsed.phoneRaw);
  const receivedAt =
    message.receivedAt && Date.parse(message.receivedAt) <= Date.now() ? message.receivedAt : null;

  let leadId: string | null = null;
  if (phone) {
    const byPhone = await supabaseAdmin
      .from("leads")
      .select("id, consent_status, lead_source, name, email, vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, symptoms")
      .eq("phone_e164", phone)
      .maybeSingle();
    if (byPhone.error) throw byPhone.error;
    if (byPhone.data?.consent_status === "opted_out") {
      await insertReceipt({
        message,
        parsed,
        leadId: byPhone.data.id,
        status: "skipped",
      });
      await addEvent(
        byPhone.data.id,
        "intake_opt_out_respected",
        `Inbound ${parsed.source} notice attached; opted-out lead was not messaged`,
        "system",
        { external_id: parsed.externalId, provider_message_id: message.messageId },
      );
      return "skipped";
    }
    if (byPhone.data) leadId = byPhone.data.id;
  }

  if (!leadId && parsed.email) {
    const byEmail = await supabaseAdmin
      .from("leads")
      .select("id, consent_status")
      .eq("email", parsed.email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    if (byEmail.data?.consent_status === "opted_out") {
      await insertReceipt({ message, parsed, leadId: byEmail.data.id, status: "skipped" });
      await addEvent(
        byEmail.data.id,
        "intake_opt_out_respected",
        `Inbound ${parsed.source} notice attached; opted-out lead was not messaged`,
        "system",
        { external_id: parsed.externalId, provider_message_id: message.messageId },
      );
      return "skipped";
    }
    if (byEmail.data) leadId = byEmail.data.id;
  }

  if (parsed.customerOptOut && leadId) {
    await supabaseAdmin
      .from("leads")
      .update({
        consent_status: "opted_out",
        consent_updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .neq("consent_status", "opted_out");
    await insertReceipt({ message, parsed, leadId, status: "skipped" });
    await addEvent(leadId, "intake_opt_out_respected", "Customer message was an opt-out; no reply sent", "system", {
      external_id: parsed.externalId,
    });
    return "skipped";
  }

  if (!leadId) {
    const inserted = await supabaseAdmin
      .from("leads")
      .insert({
        lead_source: parsed.source,
        lifecycle: "New",
        name: parsed.name,
        email: parsed.email,
        phone_e164: phone,
        vehicle_year: parsed.vehicleYear,
        vehicle_make: parsed.vehicleMake,
        vehicle_model: parsed.vehicleModel,
        vehicle_mileage: parsed.vehicleMileage,
        symptoms: parsed.symptoms,
        ...(parsed.customerOptOut
          ? {
              consent_status: "opted_out" as const,
              consent_updated_at: receivedAt ?? new Date().toISOString(),
            }
          : parsed.smsOptIn
            ? {
                consent_status: "opted_in" as const,
                consent_updated_at: receivedAt ?? new Date().toISOString(),
                consent_evidence: {
                  source: parsed.source,
                  basis: "web_form",
                  evidence_ref: parsed.externalId,
                  at: receivedAt ?? new Date().toISOString(),
                },
              }
            : {}),
        ...(receivedAt ? { created_at: receivedAt } : {}),
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    leadId = inserted.data.id;
    await addEvent(leadId, "lead_created", `Lead created from ${parsed.source}`, "system", {
      external_id: parsed.externalId,
      provider_message_id: message.messageId,
      suppress_first_touch: true,
    });
  } else {
    await fillBlank(leadId, parsed, phone);
    await addEvent(leadId, "email_intake_attached", `Attached a ${parsed.source} notice to an existing lead`, "system", {
      external_id: parsed.externalId,
      provider_message_id: message.messageId,
      suppress_first_touch: true,
    });
  }

  await insertReceipt({ message, parsed, leadId, status: "ingested" });
  return "ingested";
}

async function fillBlank(
  leadId: string,
  parsed: ParsedEmailLead,
  phone: string | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(
      "lead_source, name, email, phone_e164, vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, symptoms, consent_status",
    )
    .eq("id", leadId)
    .single();
  if (error) throw error;
  const updates: Record<string, unknown> = {};
  if (!data.lead_source) updates["lead_source"] = parsed.source;
  if (!data.name && parsed.name) updates["name"] = parsed.name;
  if (!data.email && parsed.email) updates["email"] = parsed.email;
  if (!data.phone_e164 && phone) updates["phone_e164"] = phone;
  if (data.vehicle_year === null && parsed.vehicleYear !== null) updates["vehicle_year"] = parsed.vehicleYear;
  if (!data.vehicle_make && parsed.vehicleMake) updates["vehicle_make"] = parsed.vehicleMake;
  if (!data.vehicle_model && parsed.vehicleModel) updates["vehicle_model"] = parsed.vehicleModel;
  if (data.vehicle_mileage === null && parsed.vehicleMileage !== null) {
    updates["vehicle_mileage"] = parsed.vehicleMileage;
  }
  if (!data.symptoms && parsed.symptoms) updates["symptoms"] = parsed.symptoms;
  if (parsed.smsOptIn && data.consent_status === "unknown") {
    updates["consent_status"] = "opted_in";
    updates["consent_updated_at"] = new Date().toISOString();
    updates["consent_evidence"] = {
      source: parsed.source,
      basis: "web_form",
      evidence_ref: parsed.externalId,
      at: new Date().toISOString(),
    };
  }
  if (Object.keys(updates).length === 0) return;
  const { error: updateError } = await supabaseAdmin.from("leads").update(updates as never).eq("id", leadId);
  if (updateError) throw updateError;
}

async function insertReceipt(args: {
  message: GmailMessage;
  parsed: ParsedEmailLead;
  leadId: string | null;
  status: "ingested" | "skipped";
}): Promise<void> {
  const { error } = await supabaseAdmin.from("email_intake_receipts").insert({
    provider_message_id: args.message.messageId,
    source: args.parsed.source,
    external_id: args.parsed.externalId,
    lead_id: args.leadId,
    status: args.status,
    received_at: args.message.receivedAt,
    suppress_first_touch: true,
  });
  if (error && error.code !== "23505") throw error;
}
