// Pure voicemail and call-insight shaping. No secrets, no network, no SMS.
import { z } from "zod";
import type { ToolOutcome } from "../mcp/protocol.ts";
import { CALL_LOG_MAX_LOOKBACK_DAYS, mapCallRecord, type RawCallRecord } from "./call-log.ts";
import { shopDate, shopDayBounds } from "../../lib/desk-schedule.ts";
import { decideInboundPhone, normalizeLeadPhone } from "./phone.ts";

export const VOICEMAIL_SOURCE = "RingCentral Voicemail";
export const READ_MESSAGES_PERMISSION = "ReadMessages";
export const RINGSENSE_PERMISSION = "RingSense";
export const READ_RINGSENSE_INSIGHTS_PERMISSION = "ReadRingSenseInsights";

export const VOICE_INCREMENTAL_MINUTES = 180;
export const VOICE_NIGHTLY_MINUTES = 7 * 24 * 60;
export const VOICE_MAX_LOOKBACK_MINUTES = 30 * 24 * 60;
export const VOICE_OVERLAP_MINUTES = 15;
export const VOICEMAIL_PER_PAGE = 100;
export const VOICEMAIL_MAX_PAGES = 5;
export const CALL_INSIGHT_PER_PAGE = 250;
export const CALL_INSIGHT_MAX_PAGES_SHORT = 4;
export const CALL_INSIGHT_MAX_PAGES_LONG = 8;
export const CALL_INSIGHT_FETCH_CAP = 25;
export const VOICE_STORE_TEXT_CAP = 20_000;
export const VOICE_STORE_NOTES_CAP = 8_000;
export const VOICE_READ_TEXT_CAP = 8_000;
export const VOICE_SUMMARY_CAP = 500;
export const VOICE_READ_DEFAULT_DAYS = 7;
export const VOICE_READ_MAX = 50;

const PROVIDER_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const MESSAGE_ID = /^[0-9]{1,40}$/;
const DATE_ONLY = /^20\d{2}-\d{2}-\d{2}$/;

export type VoicemailPageQuery = {
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
};

export type RawVoicemailAttachment = {
  id?: number | string;
  type?: string;
  contentType?: string;
  vmDuration?: number;
  uri?: string;
};

export type RawVoicemail = {
  id?: number | string;
  direction?: string;
  type?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  readStatus?: string;
  availability?: string;
  vmTranscriptionStatus?: string;
  from?: { phoneNumber?: string; name?: string };
  to?: { phoneNumber?: string; name?: string }[];
  attachments?: RawVoicemailAttachment[];
  subject?: string;
};

export type ParsedVoicemail = {
  providerMessageId: string;
  direction: "inbound" | "outbound" | null;
  creationTime: string | null;
  lastModifiedTime: string | null;
  readStatus: string | null;
  availability: string | null;
  transcriptionStatus: string | null;
  fromPhone: string | null;
  fromName: string | null;
  toPhone: string | null;
  toName: string | null;
  durationSeconds: number | null;
  transcriptionAttachmentId: string | null;
};

export type InsightTarget = {
  callId: string;
  telephonySessionId: string | null;
  recordingId: string | null;
  phone: string | null;
  direction: "inbound" | "outbound";
  startedAt: string;
  durationSeconds: number;
  resultDetail: string;
  dedupeKey: string;
};

export type RemotePage<T> =
  | { status: "ok"; records: T[]; hasNext: boolean }
  | { status: "forbidden"; permission: string }
  | { status: "rate_limited" }
  | { status: "invalid"; message: string };

export type TranscriptionRead =
  | { status: "ok"; text: string }
  | { status: "absent" }
  | { status: "forbidden" }
  | { status: "error" };

export type InsightFetch =
  | { status: "ok"; summary: string | null; transcript: string | null; notes: string | null }
  | { status: "absent" }
  | { status: "entitlement"; permission: string }
  | { status: "rate_limited" }
  | { status: "error" };

export type LeadLink = {
  id: string;
  lifecycle: string;
  leadSource: string | null;
  created: boolean;
};

export type StoredVoicemail = {
  id: string;
  providerMessageId: string;
  leadId: string | null;
  phone: string | null;
  direction: "inbound" | "outbound" | null;
  at: string | null;
  durationSeconds: number | null;
  transcriptionStatus: string | null;
  transcriptionText: string | null;
  callerName: string | null;
  needsReview: boolean;
};

export type StoredInsight = {
  id: string;
  callId: string | null;
  telephonySessionId: string | null;
  recordingId: string | null;
  leadId: string | null;
  phone: string | null;
  direction: "inbound" | "outbound" | null;
  at: string | null;
  durationSeconds: number | null;
  resultDetail: string | null;
  summary: string | null;
  transcript: string | null;
  notes: string | null;
};

export type VoicemailWrite = {
  providerMessageId: string;
  leadId: string | null;
  phone: string | null;
  direction: "inbound" | "outbound" | null;
  at: string | null;
  lastModifiedTime: string | null;
  durationSeconds: number | null;
  readStatus: string | null;
  availability: string | null;
  transcriptionStatus: string | null;
  transcriptionText: string | null;
  callerName: string | null;
  needsReview: boolean;
};

export type InsightWrite = {
  callId: string | null;
  telephonySessionId: string | null;
  recordingId: string | null;
  leadId: string | null;
  phone: string | null;
  direction: "inbound" | "outbound" | null;
  at: string | null;
  durationSeconds: number | null;
  resultDetail: string | null;
  summary: string | null;
  transcript: string | null;
  notes: string | null;
};

export type VoiceStore = {
  findVoicemail(providerMessageId: string): Promise<StoredVoicemail | null>;
  saveVoicemail(row: VoicemailWrite): Promise<"inserted" | "updated">;
  findInsight(target: {
    callId: string;
    telephonySessionId: string | null;
  }): Promise<StoredInsight | null>;
  saveInsight(row: InsightWrite): Promise<"inserted" | "updated">;
  matchLead(
    phone: string,
  ): Promise<{ id: string; lifecycle: string; leadSource: string | null } | null>;
  createVoicemailLead(phone: string): Promise<LeadLink>;
  getWatermark(stream: "voicemail" | "call_insights"): Promise<Date | null>;
  setWatermark(stream: "voicemail" | "call_insights", watermark: Date): Promise<void>;
  recordEvent(leadId: string, eventType: string, summary: string): Promise<void>;
};

export type VoiceSyncDeps = {
  shopNumber: string | null;
  scopes: readonly string[] | null;
  listVoicemails: (query: VoicemailPageQuery) => Promise<RemotePage<RawVoicemail>>;
  readTranscription: (messageId: string, attachmentId: string) => Promise<TranscriptionRead>;
  listCalls: (query: VoicemailPageQuery) => Promise<RemotePage<RawCallRecord>>;
  fetchInsights: (target: InsightTarget) => Promise<InsightFetch>;
  store: VoiceStore;
};

export type StreamCounts = {
  since: string;
  until: string;
  scanned: number;
  inserted: number;
  updated: number;
  skipped: string | null;
  truncated: boolean;
  watermarkAdvanced: boolean;
};

export type VoicemailSyncResult = StreamCounts & {
  leadsCreated: number;
  matched: number;
  needsReview: number;
};

export type InsightSyncResult = StreamCounts & {
  connected: number;
  linked: number;
  skippedStored: number;
  notReady: number;
  entitlement: boolean;
};

export function scopesOmit(scopes: readonly string[] | null, permission: string): boolean {
  if (!scopes || scopes.length === 0) return false;
  const needle = permission.toLowerCase();
  return !scopes.some((scope) => scope.toLowerCase() === needle);
}

export function voicemailListPath(query: VoicemailPageQuery): string {
  const params = new URLSearchParams();
  params.set("messageType", "VoiceMail");
  params.set("dateFrom", query.dateFrom);
  params.set("dateTo", query.dateTo);
  params.set("page", String(query.page));
  params.set(
    "perPage",
    String(Math.min(VOICEMAIL_PER_PAGE, Math.max(1, Math.trunc(query.perPage)))),
  );
  return `/restapi/v1.0/account/~/extension/~/message-store?${params.toString()}`;
}

export function transcriptionContentPath(messageId: string, attachmentId: string): string {
  if (!MESSAGE_ID.test(messageId) || !MESSAGE_ID.test(attachmentId)) {
    throw new Error("invalid voicemail attachment id");
  }
  return `/restapi/v1.0/account/~/extension/~/message-store/${messageId}/content/${attachmentId}`;
}

export function insightRequestPath(target: {
  telephonySessionId: string | null;
  recordingId: string | null;
}): string | null {
  if (target.telephonySessionId) {
    return `/ai/ringsense/v1/public/accounts/~/domains/pbx/sessions/${encodeURIComponent(target.telephonySessionId)}/insights`;
  }
  if (target.recordingId) {
    return `/ai/ringsense/v1/public/accounts/~/domains/pbx/records/${encodeURIComponent(target.recordingId)}/insights`;
  }
  return null;
}

export function isInsightEntitlementStatus(status: number): boolean {
  return status === 403 || status === 402;
}

export function sanitizeProviderId(value: unknown): string | null {
  const raw =
    typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return PROVIDER_ID.test(trimmed) ? trimmed : null;
}

export function clipText(
  value: string | null | undefined,
  cap: number,
): { text: string | null; truncated: boolean } {
  if (typeof value !== "string") return { text: null, truncated: false };
  const trimmed = value.trim();
  if (!trimmed) return { text: null, truncated: false };
  if (trimmed.length <= cap) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, cap), truncated: true };
}

function cleanLabel(value: unknown, cap = 80): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\+?\d{7,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
  return cleaned || null;
}

function directionOf(value: string | undefined): "inbound" | "outbound" | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "inbound") return "inbound";
  if (raw === "outbound") return "outbound";
  return null;
}

function messageIdOf(value: unknown): string | null {
  const id = sanitizeProviderId(value);
  return id && MESSAGE_ID.test(id) ? id : null;
}

export function parseVoicemail(raw: RawVoicemail): ParsedVoicemail | null {
  if (raw.type && raw.type.trim().toLowerCase() !== "voicemail") return null;
  const providerMessageId = messageIdOf(raw.id);
  if (!providerMessageId) return null;
  let durationSeconds: number | null = null;
  let transcriptionAttachmentId: string | null = null;
  for (const attachment of raw.attachments ?? []) {
    const type = (attachment.type ?? "").trim().toLowerCase();
    if (type === "audiorecording" && durationSeconds == null) {
      if (typeof attachment.vmDuration === "number" && Number.isFinite(attachment.vmDuration)) {
        durationSeconds = Math.max(0, Math.round(attachment.vmDuration));
      }
    }
    if (type === "audiotranscription" && !transcriptionAttachmentId) {
      transcriptionAttachmentId = messageIdOf(attachment.id);
    }
  }
  const to = raw.to?.[0];
  return {
    providerMessageId,
    direction: directionOf(raw.direction),
    creationTime: isoOrNull(raw.creationTime),
    lastModifiedTime: isoOrNull(raw.lastModifiedTime),
    readStatus: cleanLabel(raw.readStatus, 40),
    availability: cleanLabel(raw.availability, 40),
    transcriptionStatus: cleanLabel(raw.vmTranscriptionStatus, 40),
    fromPhone: raw.from?.phoneNumber?.trim() ? raw.from.phoneNumber.trim().slice(0, 40) : null,
    fromName: cleanLabel(raw.from?.name),
    toPhone: to?.phoneNumber?.trim() ? to.phoneNumber.trim().slice(0, 40) : null,
    toName: cleanLabel(to?.name),
    durationSeconds,
    transcriptionAttachmentId,
  };
}

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function voicemailExternalParty(
  parsed: ParsedVoicemail,
  shopNumber: string | null,
): { phoneRaw: string | null; name: string | null } {
  const from = normalizeLeadPhone(parsed.fromPhone);
  const to = normalizeLeadPhone(parsed.toPhone);
  if (shopNumber && from === shopNumber && to && to !== shopNumber) {
    return { phoneRaw: parsed.toPhone, name: parsed.toName };
  }
  if (shopNumber && to === shopNumber && from && from !== shopNumber) {
    return { phoneRaw: parsed.fromPhone, name: parsed.fromName };
  }
  if (from && from !== shopNumber) return { phoneRaw: parsed.fromPhone, name: parsed.fromName };
  if (to && to !== shopNumber) return { phoneRaw: parsed.toPhone, name: parsed.toName };
  return { phoneRaw: null, name: parsed.fromName ?? parsed.toName };
}

export function transcriptionReady(parsed: ParsedVoicemail): boolean {
  if (!parsed.transcriptionAttachmentId) return false;
  const status = (parsed.transcriptionStatus ?? "").toLowerCase();
  return status === "completed" || status === "completedpartially";
}

export function insightTargetFromCall(
  raw: RawCallRecord,
  shopNumber: string | null,
): InsightTarget | null {
  const mapped = mapCallRecord(raw, shopNumber);
  if (!mapped || mapped.result !== "answered" || !mapped.id) return null;
  const telephonySessionId = sanitizeProviderId(raw.telephonySessionId);
  const recordingId = sanitizeProviderId(raw.recording?.id);
  if (!telephonySessionId && !recordingId) return null;
  const phone =
    mapped.externalPhone &&
    mapped.externalPhone !== "unavailable" &&
    mapped.externalPhone !== shopNumber
      ? mapped.externalPhone
      : null;
  return {
    callId: mapped.id,
    telephonySessionId,
    recordingId,
    phone,
    direction: mapped.direction,
    startedAt: new Date(mapped.startMs).toISOString(),
    durationSeconds: mapped.durationSeconds,
    resultDetail: mapped.resultDetail,
    dedupeKey: telephonySessionId ?? mapped.id,
  };
}

function insightRecords(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record["records"])) {
    return record["records"].filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
    );
  }
  if (record["insights"] && typeof record["insights"] === "object") return [record];
  return [];
}

function pieceText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const text = record["text"] ?? record["value"];
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function speakerNames(record: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>();
  const info = record["speakerInfo"];
  if (!Array.isArray(info)) return names;
  for (const item of info) {
    if (!item || typeof item !== "object") continue;
    const speaker = item as Record<string, unknown>;
    const id = typeof speaker["speakerId"] === "string" ? speaker["speakerId"] : null;
    const name = cleanLabel(speaker["name"]);
    if (id && name) names.set(id, name);
  }
  return names;
}

function transcriptLines(record: Record<string, unknown>): string[] {
  const insights = record["insights"];
  if (!insights || typeof insights !== "object") return [];
  const turns = (insights as Record<string, unknown>)["Transcript"];
  if (!Array.isArray(turns)) return [];
  const names = speakerNames(record);
  const lines: string[] = [];
  let unnamed = 0;
  for (const turn of turns) {
    if (!turn || typeof turn !== "object") continue;
    const item = turn as Record<string, unknown>;
    if (typeof item["text"] !== "string" || !item["text"].trim()) continue;
    const speakerId = typeof item["speakerId"] === "string" ? item["speakerId"] : "";
    let label = speakerId ? names.get(speakerId) : undefined;
    if (!label) {
      unnamed += 1;
      label = `Speaker ${unnamed}`;
    }
    lines.push(`${label}: ${item["text"].trim()}`);
  }
  return lines;
}

export function parseInsightPayload(payload: unknown): {
  summary: string | null;
  transcript: string | null;
  notes: string | null;
} | null {
  const records = insightRecords(payload);
  if (records.length === 0) return null;
  const summaryParts: string[] = [];
  const noteParts: string[] = [];
  const transcriptParts: string[] = [];
  for (const record of records) {
    const insights =
      record["insights"] && typeof record["insights"] === "object"
        ? (record["insights"] as Record<string, unknown>)
        : {};
    summaryParts.push(...pieceText(insights["Summary"]));
    const bullets = pieceText(insights["BulletedSummary"]);
    const callNotes = pieceText(insights["CallNotes"]);
    const nextSteps = pieceText(insights["NextSteps"]);
    if (summaryParts.length === 0) summaryParts.push(...bullets);
    noteParts.push(...callNotes);
    if (callNotes.length === 0) noteParts.push(...bullets);
    noteParts.push(...nextSteps);
    transcriptParts.push(...transcriptLines(record));
  }
  const summary = clipText(summaryParts.join("\n\n"), VOICE_STORE_NOTES_CAP).text;
  const notes = clipText(noteParts.join("\n"), VOICE_STORE_NOTES_CAP).text;
  const transcript = clipText(transcriptParts.join("\n"), VOICE_STORE_TEXT_CAP).text;
  if (!summary && !notes && !transcript) return null;
  return {
    summary: summary ?? (notes ? clipText(notes, VOICE_SUMMARY_CAP).text : null),
    transcript,
    notes,
  };
}

export function resolveVoiceWindow(input: {
  now: Date;
  lookbackMinutes: number;
  watermark: Date | null;
}): { since: Date; until: Date } {
  const lookback = Math.min(
    VOICE_MAX_LOOKBACK_MINUTES,
    Math.max(1, Math.trunc(input.lookbackMinutes)),
  );
  const requested = new Date(input.now.getTime() - lookback * 60_000);
  const fromWatermark = input.watermark
    ? new Date(input.watermark.getTime() - VOICE_OVERLAP_MINUTES * 60_000)
    : requested;
  const earliest = new Date(input.now.getTime() - VOICE_MAX_LOOKBACK_MINUTES * 60_000);
  const sinceMs = Math.max(
    earliest.getTime(),
    Math.min(requested.getTime(), fromWatermark.getTime()),
  );
  return { since: new Date(sinceMs), until: input.now };
}

export function resolveLookbackMinutes(input: {
  window: "incremental" | "nightly";
  minutes?: number | undefined;
}): { ok: true; minutes: number } | { ok: false; error: string } {
  if (input.minutes !== undefined) {
    if (
      !Number.isInteger(input.minutes) ||
      input.minutes < 1 ||
      input.minutes > VOICE_MAX_LOOKBACK_MINUTES
    ) {
      return {
        ok: false,
        error: `minutes must be an integer between 1 and ${VOICE_MAX_LOOKBACK_MINUTES}`,
      };
    }
    return { ok: true, minutes: input.minutes };
  }
  return {
    ok: true,
    minutes: input.window === "nightly" ? VOICE_NIGHTLY_MINUTES : VOICE_INCREMENTAL_MINUTES,
  };
}

function insightPages(lookbackMinutes: number): number {
  return lookbackMinutes > 24 * 60 ? CALL_INSIGHT_MAX_PAGES_LONG : CALL_INSIGHT_MAX_PAGES_SHORT;
}

function hasInsightText(row: StoredInsight): boolean {
  return Boolean(row.summary || row.transcript || row.notes);
}

export async function syncVoicemails(
  deps: VoiceSyncDeps,
  now: Date,
  lookbackMinutes: number,
): Promise<VoicemailSyncResult> {
  const watermark = await deps.store.getWatermark("voicemail");
  const window = resolveVoiceWindow({ now, lookbackMinutes, watermark });
  const result: VoicemailSyncResult = {
    since: window.since.toISOString(),
    until: window.until.toISOString(),
    scanned: 0,
    inserted: 0,
    updated: 0,
    leadsCreated: 0,
    matched: 0,
    needsReview: 0,
    skipped: null,
    truncated: false,
    watermarkAdvanced: false,
  };

  if (scopesOmit(deps.scopes, READ_MESSAGES_PERMISSION)) {
    result.skipped = READ_MESSAGES_PERMISSION;
    return result;
  }

  let page = 1;
  let complete = false;
  while (page <= VOICEMAIL_MAX_PAGES) {
    const batch = await deps.listVoicemails({
      dateFrom: window.since.toISOString(),
      dateTo: window.until.toISOString(),
      page,
      perPage: VOICEMAIL_PER_PAGE,
    });
    if (batch.status === "forbidden") {
      result.skipped = batch.permission || READ_MESSAGES_PERMISSION;
      return result;
    }
    if (batch.status === "rate_limited") {
      result.truncated = true;
      result.skipped = "rate_limited";
      return result;
    }
    if (batch.status === "invalid") {
      result.skipped = "invalid";
      return result;
    }
    for (const raw of batch.records) {
      const saved = await ingestVoicemail(deps, raw);
      if (!saved) continue;
      result.scanned += 1;
      if (saved.action === "inserted") result.inserted += 1;
      else result.updated += 1;
      if (saved.leadsCreated) result.leadsCreated += 1;
      if (saved.matched) result.matched += 1;
      if (saved.needsReview) result.needsReview += 1;
    }
    if (!batch.hasNext) {
      complete = true;
      break;
    }
    page += 1;
  }
  if (!complete && page > VOICEMAIL_MAX_PAGES) result.truncated = true;
  if (complete) {
    await deps.store.setWatermark("voicemail", window.until);
    result.watermarkAdvanced = true;
  }
  return result;
}

type IngestVoicemail = {
  action: "inserted" | "updated";
  leadsCreated: boolean;
  matched: boolean;
  needsReview: boolean;
};

async function ingestVoicemail(
  deps: VoiceSyncDeps,
  raw: RawVoicemail,
): Promise<IngestVoicemail | null> {
  const parsed = parseVoicemail(raw);
  if (!parsed) return null;
  const existing = await deps.store.findVoicemail(parsed.providerMessageId);
  const party = voicemailExternalParty(parsed, deps.shopNumber);
  const decision = decideInboundPhone(party.phoneRaw);
  const phone = decision.action === "accept" ? decision.phone : null;
  const usablePhone = phone && phone !== deps.shopNumber ? phone : null;

  let leadId = existing?.leadId ?? null;
  let leadsCreated = false;
  let matched = false;
  if (!leadId && usablePhone) {
    const lead = await deps.store.createVoicemailLead(usablePhone);
    if (lead.created && lead.lifecycle !== "New") {
      throw new Error("Voicemail lead creation must leave lifecycle New");
    }
    leadId = lead.id;
    leadsCreated = lead.created;
    matched = !lead.created;
  }

  let transcriptionText = existing?.transcriptionText ?? null;
  if (transcriptionReady(parsed) && !transcriptionText && parsed.transcriptionAttachmentId) {
    const read = await deps.readTranscription(
      parsed.providerMessageId,
      parsed.transcriptionAttachmentId,
    );
    if (read.status === "ok") transcriptionText = clipText(read.text, VOICE_STORE_TEXT_CAP).text;
  }

  const needsReview = !leadId;
  const action = await deps.store.saveVoicemail({
    providerMessageId: parsed.providerMessageId,
    leadId,
    phone: usablePhone ?? existing?.phone ?? null,
    direction: parsed.direction,
    at: parsed.creationTime,
    lastModifiedTime: parsed.lastModifiedTime,
    durationSeconds: parsed.durationSeconds,
    readStatus: parsed.readStatus,
    availability: parsed.availability,
    transcriptionStatus: parsed.transcriptionStatus,
    transcriptionText,
    callerName: party.name,
    needsReview,
  });
  if (action === "inserted" && leadId) {
    await deps.store.recordEvent(leadId, "voicemail_received", "Voicemail stored");
  }
  return { action, leadsCreated, matched, needsReview };
}

export async function syncCallInsights(
  deps: VoiceSyncDeps,
  now: Date,
  lookbackMinutes: number,
): Promise<InsightSyncResult> {
  const watermark = await deps.store.getWatermark("call_insights");
  const window = resolveVoiceWindow({ now, lookbackMinutes, watermark });
  const result: InsightSyncResult = {
    since: window.since.toISOString(),
    until: window.until.toISOString(),
    scanned: 0,
    inserted: 0,
    updated: 0,
    connected: 0,
    linked: 0,
    skippedStored: 0,
    notReady: 0,
    skipped: null,
    truncated: false,
    watermarkAdvanced: false,
    entitlement: false,
  };

  if (scopesOmit(deps.scopes, "ReadCallLog")) {
    result.skipped = "ReadCallLog";
    return result;
  }
  if (scopesOmit(deps.scopes, RINGSENSE_PERMISSION)) {
    result.skipped = RINGSENSE_PERMISSION;
    result.entitlement = true;
    return result;
  }

  const seen = new Set<string>();
  let fetches = 0;
  let page = 1;
  let complete = false;
  const maxPages = insightPages(lookbackMinutes);
  while (page <= maxPages) {
    const batch = await deps.listCalls({
      dateFrom: window.since.toISOString(),
      dateTo: window.until.toISOString(),
      page,
      perPage: CALL_INSIGHT_PER_PAGE,
    });
    if (batch.status === "forbidden") {
      result.skipped = batch.permission || "ReadCallLog";
      return result;
    }
    if (batch.status === "rate_limited") {
      result.truncated = true;
      result.skipped = "rate_limited";
      return result;
    }
    if (batch.status === "invalid") {
      result.skipped = "invalid";
      return result;
    }
    for (const raw of batch.records) {
      result.scanned += 1;
      const target = insightTargetFromCall(raw, deps.shopNumber);
      if (!target || seen.has(target.dedupeKey)) continue;
      seen.add(target.dedupeKey);
      result.connected += 1;
      const existing = await deps.store.findInsight(target);
      if (existing && hasInsightText(existing)) {
        result.skippedStored += 1;
        continue;
      }
      if (fetches >= CALL_INSIGHT_FETCH_CAP) {
        result.truncated = true;
        break;
      }
      fetches += 1;
      const fetched = await deps.fetchInsights(target);
      if (fetched.status === "entitlement") {
        result.entitlement = true;
        result.skipped = fetched.permission || RINGSENSE_PERMISSION;
        return result;
      }
      if (fetched.status === "rate_limited") {
        result.truncated = true;
        result.skipped = "rate_limited";
        return result;
      }
      if (fetched.status !== "ok") {
        result.notReady += 1;
        continue;
      }
      const saved = await ingestInsight(deps, target, existing, fetched);
      if (saved.action === "inserted") result.inserted += 1;
      else result.updated += 1;
      if (saved.linked) result.linked += 1;
    }
    if (result.truncated) break;
    if (!batch.hasNext) {
      complete = true;
      break;
    }
    page += 1;
  }
  if (!complete && !result.truncated && page > maxPages) result.truncated = true;
  if (complete && !result.truncated) {
    await deps.store.setWatermark("call_insights", window.until);
    result.watermarkAdvanced = true;
  }
  return result;
}

async function ingestInsight(
  deps: VoiceSyncDeps,
  target: InsightTarget,
  existing: StoredInsight | null,
  fetched: Extract<InsightFetch, { status: "ok" }>,
): Promise<{ action: "inserted" | "updated"; linked: boolean }> {
  let leadId = existing?.leadId ?? null;
  if (!leadId && target.phone) {
    const lead = await deps.store.matchLead(target.phone);
    leadId = lead?.id ?? null;
  }
  const action = await deps.store.saveInsight({
    callId: existing?.callId ?? target.callId,
    telephonySessionId: existing?.telephonySessionId ?? target.telephonySessionId,
    recordingId: existing?.recordingId ?? target.recordingId,
    leadId,
    phone: target.phone ?? existing?.phone ?? null,
    direction: target.direction,
    at: target.startedAt,
    durationSeconds: target.durationSeconds,
    resultDetail: target.resultDetail,
    summary: fetched.summary ?? existing?.summary ?? null,
    transcript: fetched.transcript ?? existing?.transcript ?? null,
    notes: fetched.notes ?? existing?.notes ?? null,
  });
  if (action === "inserted" && leadId) {
    await deps.store.recordEvent(leadId, "call_insight_stored", "Call notes stored");
  }
  return { action, linked: Boolean(leadId) };
}

export async function syncRingCentralVoice(
  deps: VoiceSyncDeps,
  now: Date,
  lookbackMinutes: number,
): Promise<{ voicemail: VoicemailSyncResult; insights: InsightSyncResult }> {
  const voicemail = await syncVoicemails(deps, now, lookbackMinutes);
  const insights = await syncCallInsights(deps, now, lookbackMinutes);
  return { voicemail, insights };
}

export type VoiceReader = {
  listVoicemails(filter: {
    since: string | null;
    phone: string | null;
    leadId: string | null;
    limit: number;
  }): Promise<StoredVoicemail[]>;
  listInsights(filter: {
    since: string | null;
    phone: string | null;
    leadId: string | null;
    callId: string | null;
    limit: number;
  }): Promise<StoredInsight[]>;
  latestVoicemail(leadId: string): Promise<StoredVoicemail | null>;
  latestInsight(leadId: string): Promise<StoredInsight | null>;
};

const voicemailReadSchema = z
  .object({
    since: z.string().min(1).max(40).optional(),
    phone: z.string().min(1).max(40).optional(),
    leadId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(VOICE_READ_MAX).optional(),
  })
  .strict();

const insightReadSchema = voicemailReadSchema
  .extend({
    callId: z.string().regex(PROVIDER_ID).optional(),
  })
  .strict();

function invalid(error: z.ZodError): ToolOutcome {
  return {
    resultCode: "invalid",
    isError: true,
    value: {
      error: "Invalid arguments",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
  };
}

function failed(resultCode: string, error: string): ToolOutcome {
  return { resultCode, isError: true, value: { ok: false, error } };
}

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T12:00:00Z`);
  const end = Date.parse(`${later}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function resolveReadSince(
  since: string | undefined,
  now: Date,
): { ok: true; since: Date } | { ok: false; error: string } {
  if (since === undefined) {
    return { ok: true, since: new Date(now.getTime() - VOICE_READ_DEFAULT_DAYS * 86_400_000) };
  }
  const trimmed = since.trim();
  let parsed: Date | null = null;
  if (DATE_ONLY.test(trimmed)) {
    try {
      parsed = new Date(shopDayBounds(trimmed).start);
    } catch {
      parsed = null;
    }
  } else {
    const ms = Date.parse(trimmed);
    parsed = Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (!parsed) return { ok: false, error: "since must be YYYY-MM-DD or an ISO timestamp" };
  if (parsed.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, error: "since is in the future" };
  }
  const lookback = daysBetween(shopDate(parsed), shopDate(now));
  if (lookback > CALL_LOG_MAX_LOOKBACK_DAYS) {
    return { ok: false, error: `since is older than ${CALL_LOG_MAX_LOOKBACK_DAYS} days` };
  }
  return { ok: true, since: parsed };
}

export function publicVoicemail(row: StoredVoicemail) {
  const transcription = clipText(row.transcriptionText, VOICE_READ_TEXT_CAP);
  return {
    id: row.id,
    providerMessageId: row.providerMessageId,
    leadId: row.leadId,
    phone: row.phone,
    at: row.at,
    direction: row.direction,
    durationSeconds: row.durationSeconds,
    transcriptionStatus: row.transcriptionStatus,
    transcription: transcription.text,
    transcriptionTruncated: transcription.truncated,
    callerName: row.callerName,
    needsReview: row.needsReview,
  };
}

export function publicInsight(row: StoredInsight) {
  const summary = clipText(row.summary, VOICE_READ_TEXT_CAP);
  const transcript = clipText(row.transcript, VOICE_READ_TEXT_CAP);
  const notes = clipText(row.notes, VOICE_READ_TEXT_CAP);
  return {
    id: row.id,
    callId: row.callId,
    telephonySessionId: row.telephonySessionId,
    recordingId: row.recordingId,
    leadId: row.leadId,
    phone: row.phone,
    direction: row.direction,
    at: row.at,
    durationSeconds: row.durationSeconds,
    resultDetail: row.resultDetail,
    summary: summary.text,
    summaryTruncated: summary.truncated,
    transcript: transcript.text,
    transcriptTruncated: transcript.truncated,
    notes: notes.text,
    notesTruncated: notes.truncated,
  };
}

export function lookupVoiceSummary(input: {
  voicemail: StoredVoicemail | null;
  insight: StoredInsight | null;
}): {
  latestVoicemail: Record<string, unknown> | null;
  latestCallInsight: Record<string, unknown> | null;
} {
  const voicemail = input.voicemail
    ? clipText(input.voicemail.transcriptionText, VOICE_SUMMARY_CAP)
    : null;
  const insightSummary = input.insight
    ? clipText(input.insight.summary ?? input.insight.transcript, VOICE_SUMMARY_CAP)
    : null;
  return {
    latestVoicemail: input.voicemail
      ? {
          id: input.voicemail.id,
          providerMessageId: input.voicemail.providerMessageId,
          at: input.voicemail.at,
          transcriptionStatus: input.voicemail.transcriptionStatus,
          summary: voicemail?.text ?? null,
          summaryTruncated: voicemail?.truncated ?? false,
        }
      : null,
    latestCallInsight: input.insight
      ? {
          id: input.insight.id,
          callId: input.insight.callId,
          telephonySessionId: input.insight.telephonySessionId,
          at: input.insight.at,
          summary: insightSummary?.text ?? null,
          summaryTruncated: insightSummary?.truncated ?? false,
          hasTranscript: Boolean(input.insight.transcript),
        }
      : null,
  };
}

async function readFilters(
  args: unknown,
  now: Date,
  schema: typeof voicemailReadSchema | typeof insightReadSchema,
): Promise<
  | {
      ok: true;
      since: string | null;
      phone: string | null;
      leadId: string | null;
      callId: string | null;
      limit: number;
    }
  | { ok: false; outcome: ToolOutcome }
> {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, outcome: invalid(parsed.error) };
  let phone: string | null = null;
  if (parsed.data.phone !== undefined) {
    phone = normalizeLeadPhone(parsed.data.phone);
    if (!phone)
      return { ok: false, outcome: failed("invalid", "phone must be a US number or E.164") };
  }
  const callId =
    "callId" in parsed.data && typeof parsed.data.callId === "string" ? parsed.data.callId : null;
  const exact = Boolean(callId) && parsed.data.since === undefined;
  let sinceIso: string | null = null;
  if (!exact) {
    const bound = resolveReadSince(parsed.data.since, now);
    if (!bound.ok) return { ok: false, outcome: failed("invalid", bound.error) };
    sinceIso = bound.since.toISOString();
  }
  return {
    ok: true,
    since: sinceIso,
    phone,
    leadId: parsed.data.leadId ?? null,
    callId,
    limit: parsed.data.limit ?? 25,
  };
}

export async function queryVoicemails(
  args: unknown,
  now: Date,
  reader: VoiceReader,
): Promise<ToolOutcome> {
  const filter = await readFilters(args, now, voicemailReadSchema);
  if (!filter.ok) return filter.outcome;
  const rows = await reader.listVoicemails({
    since: filter.since,
    phone: filter.phone,
    leadId: filter.leadId,
    limit: filter.limit + 1,
  });
  return {
    resultCode: "ok",
    isError: false,
    value: {
      ok: true,
      voicemails: rows.slice(0, filter.limit).map((row) => publicVoicemail(row)),
      truncated: rows.length > filter.limit,
    },
  };
}

export async function queryCallInsights(
  args: unknown,
  now: Date,
  reader: VoiceReader,
): Promise<ToolOutcome> {
  const filter = await readFilters(args, now, insightReadSchema);
  if (!filter.ok) return filter.outcome;
  const rows = await reader.listInsights({
    since: filter.since,
    phone: filter.phone,
    leadId: filter.leadId,
    callId: filter.callId,
    limit: filter.limit + 1,
  });
  return {
    resultCode: "ok",
    isError: false,
    value: {
      ok: true,
      insights: rows.slice(0, filter.limit).map((row) => publicInsight(row)),
      truncated: rows.length > filter.limit,
    },
  };
}
