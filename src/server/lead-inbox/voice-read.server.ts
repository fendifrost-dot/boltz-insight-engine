// Read stored voicemails and call notes for MCP. Does not call RingCentral or send SMS.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ToolOutcome } from "../mcp/protocol.ts";
import { isMissingVoiceStore, safeVoiceDetail } from "./voice-intake.server.ts";
import {
  lookupVoiceSummary,
  queryCallInsights,
  queryVoicemails,
  type StoredInsight,
  type StoredVoicemail,
  type VoiceReader,
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

const VOICEMAIL_COLUMNS =
  "id, provider_message_id, lead_id, phone_e164, direction, creation_time, duration_seconds, transcription_status, transcription_text, caller_name, needs_review";
const INSIGHT_COLUMNS =
  "id, call_id, telephony_session_id, recording_id, lead_id, phone_e164, direction, started_at, duration_seconds, result_detail, summary, transcript, notes";

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

function unavailable(error: string): ToolOutcome {
  return { resultCode: "unavailable", isError: true, value: { ok: false, error } };
}

function dbFailed(error: { message: string }): ToolOutcome {
  console.error("[mcp voice]", safeVoiceDetail(error.message));
  return { resultCode: "error", isError: true, value: { error: "request failed" } };
}

function liveReader(): VoiceReader {
  return {
    async listVoicemails(filter) {
      let query = supabaseAdmin
        .from("ringcentral_voicemails")
        .select(VOICEMAIL_COLUMNS)
        .order("creation_time", { ascending: false })
        .limit(filter.limit);
      if (filter.since) query = query.gte("creation_time", filter.since);
      if (filter.phone) query = query.eq("phone_e164", filter.phone);
      if (filter.leadId) query = query.eq("lead_id", filter.leadId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => voicemailFromRow(row));
    },
    async listInsights(filter) {
      const run = () => {
        let query = supabaseAdmin
          .from("ringcentral_call_insights")
          .select(INSIGHT_COLUMNS)
          .order("started_at", { ascending: false })
          .limit(filter.limit);
        if (filter.since) query = query.gte("started_at", filter.since);
        if (filter.phone) query = query.eq("phone_e164", filter.phone);
        if (filter.leadId) query = query.eq("lead_id", filter.leadId);
        return query;
      };
      if (!filter.callId) {
        const { data, error } = await run();
        if (error) throw error;
        return (data ?? []).map((row) => insightFromRow(row));
      }
      const [byCall, bySession] = await Promise.all([
        run().eq("call_id", filter.callId),
        run().eq("telephony_session_id", filter.callId),
      ]);
      if (byCall.error) throw byCall.error;
      if (bySession.error) throw bySession.error;
      const merged = new Map<string, InsightRow>();
      for (const row of [...(byCall.data ?? []), ...(bySession.data ?? [])])
        merged.set(row.id, row);
      return [...merged.values()]
        .sort((left, right) => (right.started_at ?? "").localeCompare(left.started_at ?? ""))
        .slice(0, filter.limit)
        .map((row) => insightFromRow(row));
    },
    async latestVoicemail(leadId) {
      const { data, error } = await supabaseAdmin
        .from("ringcentral_voicemails")
        .select(VOICEMAIL_COLUMNS)
        .eq("lead_id", leadId)
        .order("creation_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? voicemailFromRow(data) : null;
    },
    async latestInsight(leadId) {
      const { data, error } = await supabaseAdmin
        .from("ringcentral_call_insights")
        .select(INSIGHT_COLUMNS)
        .eq("lead_id", leadId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? insightFromRow(data) : null;
    },
  };
}

async function guard(work: () => Promise<ToolOutcome>, missing: string): Promise<ToolOutcome> {
  try {
    return await work();
  } catch (error) {
    const record = error as { code?: string; message?: string };
    if (isMissingVoiceStore(record)) return unavailable(missing);
    return dbFailed({ message: record.message ?? "request failed" });
  }
}

export function voicemailsTool(
  args: unknown,
  now: Date,
  reader?: VoiceReader,
): Promise<ToolOutcome> {
  return guard(
    () => queryVoicemails(args, now, reader ?? liveReader()),
    "Voicemail store is not available yet",
  );
}

export function callInsightsTool(
  args: unknown,
  now: Date,
  reader?: VoiceReader,
): Promise<ToolOutcome> {
  return guard(
    () => queryCallInsights(args, now, reader ?? liveReader()),
    "Call notes store is not available yet",
  );
}

export async function latestVoiceForLead(
  leadId: string,
  reader?: VoiceReader,
): Promise<
  | { voiceAvailable: true; latestVoicemail: unknown; latestCallInsight: unknown }
  | { voiceAvailable: false; latestVoicemail: null; latestCallInsight: null }
> {
  const source = reader ?? liveReader();
  try {
    const [voicemail, insight] = await Promise.all([
      source.latestVoicemail(leadId),
      source.latestInsight(leadId),
    ]);
    return { voiceAvailable: true, ...lookupVoiceSummary({ voicemail, insight }) };
  } catch (error) {
    const record = error as { code?: string; message?: string };
    if (!isMissingVoiceStore(record)) {
      console.error("[mcp voice]", safeVoiceDetail(record.message ?? "request failed"));
    }
    return { voiceAvailable: false, latestVoicemail: null, latestCallInsight: null };
  }
}
