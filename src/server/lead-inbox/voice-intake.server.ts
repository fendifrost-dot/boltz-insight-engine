// Scheduled RingCentral voicemail and call-note intake. Does not send SMS or change lifecycle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { isAppCallLogDenial, type RawCallRecord } from "./call-log.ts";
import { readSecret } from "./env.server.ts";
import { normalizeLeadPhone } from "./phone.ts";
import {
  grantedScopes,
  listVoicemailPage,
  readCallInsights,
  readCallLogPage,
  readVoicemailTranscription,
  RingCentralHttpError,
} from "./ringcentral.server.ts";
import { addEvent, getOrCreateLeadThread, recordHealth } from "./store.server.ts";
import {
  READ_MESSAGES_PERMISSION,
  RINGSENSE_PERMISSION,
  VOICEMAIL_SOURCE,
  isInsightEntitlementStatus,
  parseInsightPayload,
  syncRingCentralVoice,
  type InsightFetch,
  type InsightWrite,
  type RemotePage,
  type StoredInsight,
  type StoredVoicemail,
  type TranscriptionRead,
  type VoiceStore,
  type VoiceSyncDeps,
  type VoicemailWrite,
} from "./voice-intake.ts";

type VoicemailRow = {
  id: string;
  provider_message_id: string;
  lead_id: string | null;
  phone_e164: string | null;
  direction: string | null;
  creation_time: string | null;
  duration_seconds: number | null;
  transcription_status: string | null;
  transcription_text: string | null;
  caller_name: string | null;
  needs_review: boolean;
};

type InsightRow = {
  id: string;
  call_id: string | null;
  telephony_session_id: string | null;
  recording_id: string | null;
  lead_id: string | null;
  phone_e164: string | null;
  direction: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  result_detail: string | null;
  summary: string | null;
  transcript: string | null;
  notes: string | null;
};

export function safeVoiceDetail(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-jwt]")
    .replace(/\+?\d{7,}/g, "[redacted]")
    .slice(0, 300);
}

export function isMissingVoiceStore(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  const message = error.message ?? "";
  return (
    /ringcentral_(voicemails|call_insights|sync_cursors)/i.test(message) &&
    /does not exist|schema cache|Could not find/i.test(message)
  );
}

function directionOf(value: string | null): "inbound" | "outbound" | null {
  if (value === "inbound" || value === "outbound") return value;
  return null;
}

function voicemailFromRow(row: VoicemailRow): StoredVoicemail {
  return {
    id: row.id,
    providerMessageId: row.provider_message_id,
    leadId: row.lead_id,
    phone: row.phone_e164,
    direction: directionOf(row.direction),
    at: row.creation_time,
    durationSeconds: row.duration_seconds,
    transcriptionStatus: row.transcription_status,
    transcriptionText: row.transcription_text,
    callerName: row.caller_name,
    needsReview: row.needs_review,
  };
}

function insightFromRow(row: InsightRow): StoredInsight {
  return {
    id: row.id,
    callId: row.call_id,
    telephonySessionId: row.telephony_session_id,
    recordingId: row.recording_id,
    leadId: row.lead_id,
    phone: row.phone_e164,
    direction: directionOf(row.direction),
    at: row.started_at,
    durationSeconds: row.duration_seconds,
    resultDetail: row.result_detail,
    summary: row.summary,
    transcript: row.transcript,
    notes: row.notes,
  };
}

function isExtensionFallback(error: unknown): error is RingCentralHttpError {
  if (!(error instanceof RingCentralHttpError)) return false;
  if (error.status === 404) return true;
  if (error.status !== 403) return false;
  return !isAppCallLogDenial(error);
}

function mapRemoteError(error: unknown, permission: string): RemotePage<never> | null {
  if (!(error instanceof RingCentralHttpError)) return null;
  if (error.status === 403 || error.status === 402) {
    return { status: "forbidden", permission: error.permissionNames[0] ?? permission };
  }
  if (error.status === 429) return { status: "rate_limited" };
  if (error.status === 400) return { status: "invalid", message: "rejected" };
  return null;
}

async function matchLead(phone: string): Promise<{
  id: string;
  lifecycle: string;
  leadSource: string | null;
} | null> {
  const { data: thread, error: threadError } = await supabaseAdmin
    .from("message_threads")
    .select("lead_id")
    .eq("phone_e164", phone)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (threadError) throw threadError;
  const leadId = thread?.lead_id;
  const query = supabaseAdmin.from("leads").select("id, lifecycle, lead_source");
  const { data, error } = leadId
    ? await query.eq("id", leadId).maybeSingle()
    : await query.eq("phone_e164", phone).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, lifecycle: data.lifecycle, leadSource: data.lead_source };
}

async function createVoicemailLead(phone: string) {
  const before = await matchLead(phone);
  try {
    const { lead } = await getOrCreateLeadThread(phone, VOICEMAIL_SOURCE);
    return {
      id: lead.id,
      lifecycle: lead.lifecycle,
      leadSource: lead.lead_source,
      created: !before,
    };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const again = await matchLead(phone);
      if (again) return { ...again, created: false };
    }
    throw error;
  }
}

async function findVoicemail(providerMessageId: string): Promise<StoredVoicemail | null> {
  const { data, error } = await supabaseAdmin
    .from("ringcentral_voicemails")
    .select(
      "id, provider_message_id, lead_id, phone_e164, direction, creation_time, duration_seconds, transcription_status, transcription_text, caller_name, needs_review",
    )
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (error) throw error;
  return data ? voicemailFromRow(data) : null;
}

async function saveVoicemail(row: VoicemailWrite): Promise<"inserted" | "updated"> {
  const existing = await findVoicemail(row.providerMessageId);
  const payload = {
    provider_message_id: row.providerMessageId,
    lead_id: row.leadId,
    phone_e164: row.phone,
    direction: row.direction,
    creation_time: row.at,
    last_modified_time: row.lastModifiedTime,
    duration_seconds: row.durationSeconds,
    read_status: row.readStatus,
    availability: row.availability,
    transcription_status: row.transcriptionStatus,
    transcription_text: row.transcriptionText,
    caller_name: row.callerName,
    needs_review: row.needsReview,
    updated_at: new Date().toISOString(),
  };
  if (!existing) {
    const { error } = await supabaseAdmin.from("ringcentral_voicemails").insert(payload);
    if (!error) return "inserted";
    if ((error as { code?: string }).code !== "23505") throw error;
  }
  const patch: Database["public"]["Tables"]["ringcentral_voicemails"]["Update"] = {
    phone_e164: row.phone,
    direction: row.direction,
    creation_time: row.at,
    last_modified_time: row.lastModifiedTime,
    duration_seconds: row.durationSeconds,
    read_status: row.readStatus,
    availability: row.availability,
    transcription_status: row.transcriptionStatus,
    caller_name: row.callerName,
    needs_review: row.needsReview,
    updated_at: new Date().toISOString(),
  };
  if (row.transcriptionText) patch.transcription_text = row.transcriptionText;
  if (row.leadId) patch.lead_id = row.leadId;
  const { error } = await supabaseAdmin
    .from("ringcentral_voicemails")
    .update(patch)
    .eq("provider_message_id", row.providerMessageId);
  if (error) throw error;
  return "updated";
}

async function findInsight(target: {
  callId: string;
  telephonySessionId: string | null;
}): Promise<StoredInsight | null> {
  const columns =
    "id, call_id, telephony_session_id, recording_id, lead_id, phone_e164, direction, started_at, duration_seconds, result_detail, summary, transcript, notes";
  if (target.telephonySessionId) {
    const { data, error } = await supabaseAdmin
      .from("ringcentral_call_insights")
      .select(columns)
      .eq("telephony_session_id", target.telephonySessionId)
      .maybeSingle();
    if (error) throw error;
    if (data) return insightFromRow(data);
  }
  const { data, error } = await supabaseAdmin
    .from("ringcentral_call_insights")
    .select(columns)
    .eq("call_id", target.callId)
    .maybeSingle();
  if (error) throw error;
  return data ? insightFromRow(data) : null;
}

async function saveInsight(row: InsightWrite): Promise<"inserted" | "updated"> {
  const existing = await findInsight({
    callId: row.callId ?? "",
    telephonySessionId: row.telephonySessionId,
  });
  const payload = {
    call_id: row.callId,
    telephony_session_id: row.telephonySessionId,
    recording_id: row.recordingId,
    lead_id: row.leadId,
    phone_e164: row.phone,
    direction: row.direction,
    started_at: row.at,
    duration_seconds: row.durationSeconds,
    result_detail: row.resultDetail,
    summary: row.summary,
    transcript: row.transcript,
    notes: row.notes,
    updated_at: new Date().toISOString(),
  };
  if (!existing) {
    const { error } = await supabaseAdmin.from("ringcentral_call_insights").insert(payload);
    if (!error) return "inserted";
    if ((error as { code?: string }).code !== "23505") throw error;
  }
  const patch: Database["public"]["Tables"]["ringcentral_call_insights"]["Update"] = {
    recording_id: row.recordingId,
    phone_e164: row.phone,
    direction: row.direction,
    started_at: row.at,
    duration_seconds: row.durationSeconds,
    result_detail: row.resultDetail,
    updated_at: new Date().toISOString(),
  };
  if (row.summary) patch.summary = row.summary;
  if (row.transcript) patch.transcript = row.transcript;
  if (row.notes) patch.notes = row.notes;
  if (row.leadId) patch.lead_id = row.leadId;
  if (row.callId) patch.call_id = row.callId;
  if (row.telephonySessionId) patch.telephony_session_id = row.telephonySessionId;
  const idFilter = existing
    ? supabaseAdmin.from("ringcentral_call_insights").update(patch).eq("id", existing.id)
    : row.telephonySessionId
      ? supabaseAdmin
          .from("ringcentral_call_insights")
          .update(patch)
          .eq("telephony_session_id", row.telephonySessionId)
      : supabaseAdmin
          .from("ringcentral_call_insights")
          .update(patch)
          .eq("call_id", row.callId ?? "");
  const { error } = await idFilter;
  if (error) throw error;
  return "updated";
}

function dbStore(): VoiceStore {
  return {
    findVoicemail,
    saveVoicemail,
    findInsight,
    saveInsight,
    matchLead,
    createVoicemailLead,
    async getWatermark(stream) {
      const { data, error } = await supabaseAdmin
        .from("ringcentral_sync_cursors")
        .select("watermark")
        .eq("stream", stream)
        .maybeSingle();
      if (error) throw error;
      if (!data?.watermark) return null;
      const ms = Date.parse(data.watermark);
      return Number.isFinite(ms) ? new Date(ms) : null;
    },
    async setWatermark(stream, watermark) {
      const { error } = await supabaseAdmin.from("ringcentral_sync_cursors").upsert(
        {
          stream,
          watermark: watermark.toISOString(),
          updated_at: new Date().toISOString(),
          last_status: "ok",
        },
        { onConflict: "stream" },
      );
      if (error) throw error;
    },
    async recordEvent(leadId, eventType, summary) {
      await addEvent(leadId, eventType, summary, "system");
    },
  };
}

async function listCalls(query: {
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
}): Promise<RemotePage<RawCallRecord>> {
  const pull = (level: "account" | "extension") =>
    readCallLogPage({
      level,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page,
      perPage: query.perPage,
    });
  try {
    const page = await pull("account");
    return { status: "ok", records: page.records, hasNext: page.hasNext };
  } catch (error) {
    if (!isExtensionFallback(error)) {
      const mapped = mapRemoteError(error, "ReadCallLog");
      if (mapped) return mapped;
      throw error;
    }
    try {
      const page = await pull("extension");
      return { status: "ok", records: page.records, hasNext: page.hasNext };
    } catch (inner) {
      const mapped = mapRemoteError(inner, "ReadCallLog");
      if (mapped) return mapped;
      throw inner;
    }
  }
}

async function readTranscription(
  messageId: string,
  attachmentId: string,
): Promise<TranscriptionRead> {
  try {
    const text = await readVoicemailTranscription(messageId, attachmentId);
    return { status: "ok", text };
  } catch (error) {
    if (error instanceof RingCentralHttpError) {
      if (error.status === 404) return { status: "absent" };
      if (error.status === 403 || error.status === 402) return { status: "forbidden" };
      return { status: "error" };
    }
    if (error instanceof Error && error.message === "invalid voicemail attachment id") {
      return { status: "error" };
    }
    throw error;
  }
}

async function fetchInsights(target: {
  telephonySessionId: string | null;
  recordingId: string | null;
}): Promise<InsightFetch> {
  try {
    const payload = await readCallInsights(target);
    const parsed = parseInsightPayload(payload);
    if (!parsed) return { status: "absent" };
    return { status: "ok", ...parsed };
  } catch (error) {
    if (!(error instanceof RingCentralHttpError)) throw error;
    if (isInsightEntitlementStatus(error.status)) {
      return {
        status: "entitlement",
        permission: error.permissionNames[0] ?? RINGSENSE_PERMISSION,
      };
    }
    if (error.status === 429) return { status: "rate_limited" };
    if (error.status === 404) return { status: "absent" };
    return { status: "error" };
  }
}

export async function liveVoiceDeps(): Promise<VoiceSyncDeps> {
  return {
    shopNumber: normalizeLeadPhone(readSecret("RINGCENTRAL_FROM_NUMBER")),
    scopes: await grantedScopes(),
    async listVoicemails(query) {
      try {
        const page = await listVoicemailPage(query);
        return { status: "ok", records: page.records, hasNext: page.hasNext };
      } catch (error) {
        const mapped = mapRemoteError(error, READ_MESSAGES_PERMISSION);
        if (mapped) return mapped;
        throw error;
      }
    },
    readTranscription,
    listCalls,
    fetchInsights,
    store: dbStore(),
  };
}

export async function runVoiceSync(now: Date, lookbackMinutes: number) {
  const summary = await syncRingCentralVoice(await liveVoiceDeps(), now, lookbackMinutes);
  await recordHealth({
    provider: "ringcentral",
    checkName: "reconcile_voicemail",
    ok: summary.voicemail.skipped == null || summary.voicemail.skipped === "rate_limited",
    detail: safeVoiceDetail(
      `scanned ${summary.voicemail.scanned}, inserted ${summary.voicemail.inserted}, leads ${summary.voicemail.leadsCreated}, skipped ${summary.voicemail.skipped ?? "none"}`,
    ),
  });
  await recordHealth({
    provider: "ringcentral",
    checkName: "reconcile_call_insights",
    ok: !summary.insights.entitlement && summary.insights.skipped !== "invalid",
    detail: safeVoiceDetail(
      `scanned ${summary.insights.scanned}, stored ${summary.insights.inserted + summary.insights.updated}, linked ${summary.insights.linked}, skipped ${summary.insights.skipped ?? "none"}`,
    ),
  });
  return summary;
}

export function missingSecretName(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = /^Missing server secret: ([A-Z0-9_]+)/.exec(error.message);
  return match?.[1] ?? null;
}
