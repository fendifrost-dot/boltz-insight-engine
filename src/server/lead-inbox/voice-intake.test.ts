import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeToolArgs, toolDefinition } from "../mcp/protocol.ts";
import type { RawCallRecord } from "./call-log.ts";
import {
  READ_MESSAGES_PERMISSION,
  RINGSENSE_PERMISSION,
  VOICEMAIL_SOURCE,
  insightRequestPath,
  insightTargetFromCall,
  lookupVoiceSummary,
  parseInsightPayload,
  parseVoicemail,
  queryCallInsights,
  queryVoicemails,
  resolveLookbackMinutes,
  resolveVoiceWindow,
  syncCallInsights,
  syncVoicemails,
  transcriptionContentPath,
  voicemailListPath,
  type InsightFetch,
  type InsightWrite,
  type StoredInsight,
  type StoredVoicemail,
  type VoiceStore,
  type VoiceSyncDeps,
  type VoicemailWrite,
} from "./voice-intake.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const NOW = new Date("2026-11-04T18:00:00.000Z");
const SHOP = "+17085754555";
const CALLER = "+17085550111";
const KNOWN = "+17085550222";

const sql = readFileSync(
  join(root, "supabase/migrations/20261104220000_ringcentral_voicemail_insights.sql"),
  "utf8",
);

test("voicemail migration is service-role only and idempotent on the message id", () => {
  for (const table of [
    "ringcentral_sync_cursors",
    "ringcentral_voicemails",
    "ringcentral_call_insights",
  ]) {
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /provider_message_id text NOT NULL UNIQUE/);
  assert.match(sql, /telephony_session_id text UNIQUE/);
  assert.match(sql, /call_id text UNIQUE/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.%I TO service_role/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /access_token/i);
  assert.doesNotMatch(sql, /content_uri/i);
  assert.doesNotMatch(sql, /bytea/i);
});

test("voicemail list and transcription paths do not carry a token or a media uri", () => {
  const path = voicemailListPath({
    dateFrom: "2026-11-04T15:00:00.000Z",
    dateTo: "2026-11-04T18:00:00.000Z",
    page: 1,
    perPage: 500,
  });
  const url = new URL(path, "https://platform.ringcentral.com");
  assert.equal(url.pathname, "/restapi/v1.0/account/~/extension/~/message-store");
  assert.equal(url.searchParams.get("messageType"), "VoiceMail");
  assert.equal(url.searchParams.get("perPage"), "100");
  assert.equal(url.searchParams.get("access_token"), null);
  assert.equal(
    transcriptionContentPath("82063400004", "82063400005"),
    "/restapi/v1.0/account/~/extension/~/message-store/82063400004/content/82063400005",
  );
  assert.throws(() => transcriptionContentPath("https://media.example/x", "1"));
});

test("voicemail parsing keeps transcription metadata and drops attachment uris", () => {
  const parsed = parseVoicemail({
    id: 82063400004,
    type: "VoiceMail",
    direction: "Inbound",
    creationTime: "2026-11-04T16:00:00.000Z",
    vmTranscriptionStatus: "Completed",
    from: { phoneNumber: "7085550111", name: "Ada 7085550999" },
    to: [{ phoneNumber: SHOP, name: "Boltz" }],
    attachments: [
      {
        id: 82063400004,
        type: "AudioRecording",
        uri: "https://media.example/voicemail?access_token=secret",
        vmDuration: 12,
      },
      { id: "82063400005", type: "AudioTranscription", contentType: "text/plain" },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed?.providerMessageId, "82063400004");
  assert.equal(parsed?.transcriptionAttachmentId, "82063400005");
  assert.equal(parsed?.durationSeconds, 12);
  assert.equal(parsed?.fromName, "Ada");
  assert.equal(JSON.stringify(parsed).includes("access_token"), false);
  assert.equal(JSON.stringify(parsed).includes("media.example"), false);
  assert.equal(parseVoicemail({ id: 1, type: "SMS" }), null);
});

test("insight parsing keeps the transcript and strips phone-shaped speaker labels", () => {
  const parsed = parseInsightPayload({
    records: [
      {
        speakerInfo: [
          { speakerId: "shop", name: "Boltz" },
          { speakerId: "caller", name: "+17085550111" },
        ],
        insights: {
          Summary: [{ value: "Customer asked about a brake inspection." }],
          CallNotes: [{ value: "Book a morning visit." }],
          Transcript: [
            { speakerId: "caller", text: "The car pulls left." },
            { speakerId: "shop", text: "We can inspect it." },
          ],
        },
      },
    ],
  });
  assert.equal(parsed?.summary, "Customer asked about a brake inspection.");
  assert.equal(parsed?.notes, "Book a morning visit.");
  assert.match(parsed?.transcript ?? "", /The car pulls left/);
  assert.equal((parsed?.transcript ?? "").includes("7085550111"), false);
  assert.equal(
    insightRequestPath({ telephonySessionId: "s-abc123", recordingId: "99" }),
    "/ai/ringsense/v1/public/accounts/~/domains/pbx/sessions/s-abc123/insights",
  );
});

test("only answered calls with a session or recording id are insight targets", () => {
  const base: RawCallRecord = {
    id: "call-1",
    telephonySessionId: "s-session-1",
    startTime: "2026-11-04T16:05:00.000Z",
    duration: 90,
    type: "Voice",
    direction: "Inbound",
    result: "Call connected",
    from: { phoneNumber: CALLER, name: "Ada" },
    to: { phoneNumber: SHOP },
    recording: { id: "55" },
  };
  const target = insightTargetFromCall(base, SHOP);
  assert.equal(target?.dedupeKey, "s-session-1");
  assert.equal(target?.phone, CALLER);
  assert.equal(target?.recordingId, "55");
  assert.equal(insightTargetFromCall({ ...base, result: "Missed" }, SHOP), null);
  assert.equal(insightTargetFromCall({ ...base, result: "Voicemail" }, SHOP), null);
  assert.equal(
    insightTargetFromCall(
      {
        id: "call-1",
        startTime: "2026-11-04T16:05:00.000Z",
        duration: 90,
        type: "Voice",
        direction: "Inbound",
        result: "Call connected",
        from: { phoneNumber: CALLER, name: "Ada" },
        to: { phoneNumber: SHOP },
      },
      SHOP,
    ),
    null,
  );
});

test("the sync window overlaps the watermark and stays inside 30 days", () => {
  const recent = resolveVoiceWindow({
    now: NOW,
    lookbackMinutes: 180,
    watermark: new Date("2026-11-01T00:00:00.000Z"),
  });
  assert.equal(recent.since.toISOString(), "2026-10-31T23:45:00.000Z");
  const capped = resolveVoiceWindow({
    now: NOW,
    lookbackMinutes: 180,
    watermark: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(capped.since.toISOString(), "2026-10-05T18:00:00.000Z");
  assert.equal(resolveLookbackMinutes({ window: "nightly" }).ok, true);
  const bad = resolveLookbackMinutes({ window: "incremental", minutes: 0 });
  assert.equal(bad.ok, false);
});

type Memory = {
  leads: Map<string, { id: string; lifecycle: string; leadSource: string | null }>;
  voicemails: Map<string, StoredVoicemail & { write: VoicemailWrite }>;
  insights: StoredInsight[];
  events: { leadId: string; eventType: string; summary: string }[];
  watermarks: Map<string, Date>;
  created: string[];
};

function memory(): { store: VoiceStore; state: Memory } {
  const state: Memory = {
    leads: new Map(),
    voicemails: new Map(),
    insights: [],
    events: [],
    watermarks: new Map(),
    created: [],
  };
  let ids = 0;
  const store: VoiceStore = {
    async findVoicemail(providerMessageId) {
      return state.voicemails.get(providerMessageId) ?? null;
    },
    async saveVoicemail(row) {
      const existing = state.voicemails.get(row.providerMessageId);
      ids += 1;
      state.voicemails.set(row.providerMessageId, {
        id: existing?.id ?? `vm-${ids}`,
        providerMessageId: row.providerMessageId,
        leadId: row.leadId ?? existing?.leadId ?? null,
        phone: row.phone ?? existing?.phone ?? null,
        direction: row.direction,
        at: row.at,
        durationSeconds: row.durationSeconds,
        transcriptionStatus: row.transcriptionStatus,
        transcriptionText: row.transcriptionText ?? existing?.transcriptionText ?? null,
        callerName: row.callerName,
        needsReview: row.needsReview,
        write: row,
      });
      return existing ? "updated" : "inserted";
    },
    async findInsight(target) {
      return (
        state.insights.find(
          (row) =>
            (target.telephonySessionId && row.telephonySessionId === target.telephonySessionId) ||
            row.callId === target.callId,
        ) ?? null
      );
    },
    async saveInsight(row: InsightWrite) {
      const existing = state.insights.find(
        (item) =>
          (row.telephonySessionId && item.telephonySessionId === row.telephonySessionId) ||
          (row.callId && item.callId === row.callId),
      );
      if (existing) {
        existing.summary = row.summary ?? existing.summary;
        existing.transcript = row.transcript ?? existing.transcript;
        existing.notes = row.notes ?? existing.notes;
        existing.leadId = row.leadId ?? existing.leadId;
        return "updated";
      }
      ids += 1;
      state.insights.push({
        id: `insight-${ids}`,
        callId: row.callId,
        telephonySessionId: row.telephonySessionId,
        recordingId: row.recordingId,
        leadId: row.leadId,
        phone: row.phone,
        direction: row.direction,
        at: row.at,
        durationSeconds: row.durationSeconds,
        resultDetail: row.resultDetail,
        summary: row.summary,
        transcript: row.transcript,
        notes: row.notes,
      });
      return "inserted";
    },
    async matchLead(phone) {
      return state.leads.get(phone) ?? null;
    },
    async createVoicemailLead(phone) {
      const existing = state.leads.get(phone);
      if (existing) return { ...existing, created: false };
      const created = {
        id: `lead-${state.leads.size + 1}`,
        lifecycle: "New",
        leadSource: VOICEMAIL_SOURCE,
      };
      state.leads.set(phone, created);
      state.created.push(phone);
      return { ...created, created: true };
    },
    async getWatermark(stream) {
      return state.watermarks.get(stream) ?? null;
    },
    async setWatermark(stream, watermark) {
      state.watermarks.set(stream, watermark);
    },
    async recordEvent(leadId, eventType, summary) {
      state.events.push({ leadId, eventType, summary });
    },
  };
  return { store, state };
}

function rawVoicemail(id: string, phone: string, status = "Completed") {
  return {
    id,
    type: "VoiceMail",
    direction: "Inbound",
    creationTime: "2026-11-04T16:00:00.000Z",
    vmTranscriptionStatus: status,
    from: { phoneNumber: phone, name: "Ada" },
    to: [{ phoneNumber: SHOP }],
    attachments:
      status === "Completed"
        ? [
            { id, type: "AudioRecording", vmDuration: 8 },
            { id: `${id}9`, type: "AudioTranscription" },
          ]
        : [{ id, type: "AudioRecording", vmDuration: 8 }],
  };
}

function deps(state: Memory, store: VoiceStore, extra?: Partial<VoiceSyncDeps>): VoiceSyncDeps {
  return {
    shopNumber: SHOP,
    scopes: ["ReadMessages", "ReadCallLog", "RingSense", "SMS"],
    listVoicemails: async () => ({ status: "ok", records: [], hasNext: false }),
    readTranscription: async () => ({ status: "ok", text: "The brakes feel soft." }),
    listCalls: async () => ({ status: "ok", records: [], hasNext: false }),
    fetchInsights: async () => ({ status: "absent" }),
    store,
    ...extra,
  };
}

test("a new voicemail creates one New lead and a second copy does not", async () => {
  const { store, state } = memory();
  const listed = [rawVoicemail("100", CALLER), rawVoicemail("100", CALLER)];
  const first = await syncVoicemails(
    deps(state, store, {
      listVoicemails: async () => ({ status: "ok", records: listed, hasNext: false }),
    }),
    NOW,
    180,
  );
  assert.equal(first.leadsCreated, 1);
  assert.equal(first.inserted, 1);
  assert.equal(first.updated, 1);
  assert.equal(state.leads.get(CALLER)?.lifecycle, "New");
  assert.equal(state.leads.get(CALLER)?.leadSource, VOICEMAIL_SOURCE);
  assert.equal(state.voicemails.get("100")?.transcriptionText, "The brakes feel soft.");
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0]?.summary.includes(CALLER), false);
  assert.equal(JSON.stringify(state.events).includes("brakes"), false);

  const second = await syncVoicemails(
    deps(state, store, {
      listVoicemails: async () => ({
        status: "ok",
        records: [rawVoicemail("100", CALLER)],
        hasNext: false,
      }),
    }),
    NOW,
    180,
  );
  assert.equal(second.leadsCreated, 0);
  assert.equal(state.created.length, 1);
  assert.equal(state.leads.size, 1);
});

test("an existing lead is reused and its lifecycle stays put", async () => {
  const { store, state } = memory();
  state.leads.set(KNOWN, {
    id: "lead-known",
    lifecycle: "Contacted",
    leadSource: "RingCentral SMS",
  });
  const result = await syncVoicemails(
    deps(state, store, {
      listVoicemails: async () => ({
        status: "ok",
        records: [rawVoicemail("200", KNOWN)],
        hasNext: false,
      }),
    }),
    NOW,
    180,
  );
  assert.equal(result.leadsCreated, 0);
  assert.equal(result.matched, 1);
  assert.equal(state.leads.get(KNOWN)?.lifecycle, "Contacted");
  assert.equal(state.leads.get(KNOWN)?.leadSource, "RingCentral SMS");
  assert.equal(state.voicemails.get("200")?.leadId, "lead-known");
});

test("a phone that cannot be stored does not create a lead", async () => {
  const { store, state } = memory();
  const result = await syncVoicemails(
    deps(state, store, {
      listVoicemails: async () => ({
        status: "ok",
        records: [rawVoicemail("300", "anonymous")],
        hasNext: false,
      }),
    }),
    NOW,
    180,
  );
  assert.equal(result.leadsCreated, 0);
  assert.equal(result.needsReview, 1);
  assert.equal(state.leads.size, 0);
  assert.equal(state.voicemails.get("300")?.needsReview, true);
  assert.equal(state.events.length, 0);
});

test("a voicemail create that is not New is refused", async () => {
  const { store, state } = memory();
  store.createVoicemailLead = async () => ({
    id: "bad",
    lifecycle: "Contacted",
    leadSource: VOICEMAIL_SOURCE,
    created: true,
  });
  await assert.rejects(
    syncVoicemails(
      deps(state, store, {
        listVoicemails: async () => ({
          status: "ok",
          records: [rawVoicemail("301", CALLER)],
          hasNext: false,
        }),
      }),
      NOW,
      180,
    ),
    /lifecycle New/,
  );
});

test("missing ReadMessages skips voicemail fetch and a 403 does not advance the watermark", async () => {
  const { store, state } = memory();
  let calls = 0;
  const skipped = await syncVoicemails(
    deps(state, store, {
      scopes: ["SMS"],
      listVoicemails: async () => {
        calls += 1;
        return { status: "ok", records: [], hasNext: false };
      },
    }),
    NOW,
    180,
  );
  assert.equal(skipped.skipped, READ_MESSAGES_PERMISSION);
  assert.equal(calls, 0);

  const forbidden = await syncVoicemails(
    deps(state, store, {
      listVoicemails: async () => ({ status: "forbidden", permission: READ_MESSAGES_PERMISSION }),
    }),
    NOW,
    180,
  );
  assert.equal(forbidden.watermarkAdvanced, false);
  assert.equal(state.watermarks.has("voicemail"), false);
});

function connected(id: string, phone: string, session: string): RawCallRecord {
  return {
    id,
    telephonySessionId: session,
    startTime: "2026-11-04T16:10:00.000Z",
    duration: 60,
    type: "Voice",
    direction: "Inbound",
    result: "Accepted",
    from: { phoneNumber: phone },
    to: { phoneNumber: SHOP },
  };
}

test("call notes link an existing lead and do not create one", async () => {
  const { store, state } = memory();
  state.leads.set(CALLER, { id: "lead-caller", lifecycle: "Qualified", leadSource: "Yelp" });
  let creates = 0;
  const original = store.createVoicemailLead;
  store.createVoicemailLead = async (phone) => {
    creates += 1;
    return original(phone);
  };
  const result = await syncCallInsights(
    deps(state, store, {
      listCalls: async () => ({
        status: "ok",
        records: [connected("call-9", CALLER, "s-9"), connected("call-miss", CALLER, "s-miss")],
        hasNext: false,
      }),
      fetchInsights: async (target) => {
        if (target.telephonySessionId === "s-miss") {
          return { status: "absent" };
        }
        return {
          status: "ok",
          summary: "Brake inspection requested.",
          transcript: "Speaker 1: It pulls left.",
          notes: "Offer a morning visit.",
        } satisfies InsightFetch;
      },
    }),
    NOW,
    180,
  );
  assert.equal(creates, 0);
  assert.equal(result.inserted, 1);
  assert.equal(result.linked, 1);
  assert.equal(result.notReady, 1);
  assert.equal(state.insights.length, 1);
  assert.equal(state.insights[0]?.leadId, "lead-caller");
  assert.equal(state.leads.get(CALLER)?.lifecycle, "Qualified");
  assert.equal(state.events[0]?.eventType, "call_insight_stored");
  assert.equal(JSON.stringify(state.events).includes("pulls left"), false);
});

test("an insights entitlement stops the run without failing the voicemail watermark", async () => {
  const { store, state } = memory();
  let fetches = 0;
  const insights = await syncCallInsights(
    deps(state, store, {
      listCalls: async () => ({
        status: "ok",
        records: [connected("c1", CALLER, "s-1"), connected("c2", KNOWN, "s-2")],
        hasNext: false,
      }),
      fetchInsights: async () => {
        fetches += 1;
        return { status: "entitlement", permission: RINGSENSE_PERMISSION };
      },
    }),
    NOW,
    180,
  );
  assert.equal(insights.entitlement, true);
  assert.equal(insights.watermarkAdvanced, false);
  assert.equal(fetches, 1);
  assert.equal(state.insights.length, 0);

  const preset = await syncCallInsights(
    deps(state, store, { scopes: ["ReadCallLog", "SMS"] }),
    NOW,
    180,
  );
  assert.equal(preset.skipped, RINGSENSE_PERMISSION);
  assert.equal(preset.entitlement, true);
});

test("stored call notes are not fetched again", async () => {
  const { store, state } = memory();
  state.insights.push({
    id: "insight-existing",
    callId: "call-9",
    telephonySessionId: "s-9",
    recordingId: null,
    leadId: "lead-caller",
    phone: CALLER,
    direction: "inbound",
    at: "2026-11-04T16:10:00.000Z",
    durationSeconds: 60,
    resultDetail: "Accepted",
    summary: "Already stored.",
    transcript: "Speaker 1: hello",
    notes: null,
  });
  let fetches = 0;
  const result = await syncCallInsights(
    deps(state, store, {
      listCalls: async () => ({
        status: "ok",
        records: [connected("call-9", CALLER, "s-9")],
        hasNext: false,
      }),
      fetchInsights: async () => {
        fetches += 1;
        return { status: "ok", summary: "new", transcript: null, notes: null };
      },
    }),
    NOW,
    180,
  );
  assert.equal(fetches, 0);
  assert.equal(result.skippedStored, 1);
  assert.equal(state.insights[0]?.summary, "Already stored.");
});

test("voicemail and insight reads filter, cap text, and keep lookup to a summary", async () => {
  const long = "brake ".repeat(2000);
  const voicemailRow: StoredVoicemail = {
    id: "vm-1",
    providerMessageId: "100",
    leadId: "lead-1",
    phone: CALLER,
    direction: "inbound",
    at: "2026-11-04T16:00:00.000Z",
    durationSeconds: 8,
    transcriptionStatus: "Completed",
    transcriptionText: long,
    callerName: "Ada",
    needsReview: false,
  };
  const insightRow: StoredInsight = {
    id: "in-1",
    callId: "call-9",
    telephonySessionId: "s-9",
    recordingId: "55",
    leadId: "lead-1",
    phone: CALLER,
    direction: "inbound",
    at: "2026-11-04T16:10:00.000Z",
    durationSeconds: 60,
    resultDetail: "Accepted",
    summary: "Brake inspection.",
    transcript: long,
    notes: "Morning visit.",
  };
  const reader = {
    async listVoicemails(filter: { phone: string | null; limit: number }) {
      assert.equal(filter.phone, CALLER);
      return [voicemailRow, { ...voicemailRow, id: "vm-2" }].slice(0, filter.limit);
    },
    async listInsights(filter: { callId: string | null; since: string | null }) {
      assert.equal(filter.callId, "call-9");
      assert.equal(filter.since, null);
      return [insightRow];
    },
    async latestVoicemail() {
      return voicemailRow;
    },
    async latestInsight() {
      return insightRow;
    },
  };
  const listed = await queryVoicemails({ phone: "(708) 555-0111", limit: 1 }, NOW, reader);
  assert.equal(listed.isError, false);
  const body = listed.value as {
    voicemails: { transcription: string; transcriptionTruncated: boolean }[];
    truncated: boolean;
  };
  assert.equal(body.truncated, true);
  assert.equal(body.voicemails[0]?.transcription.length, 8000);
  assert.equal(body.voicemails[0]?.transcriptionTruncated, true);
  assert.equal(JSON.stringify(body).includes("access_token"), false);

  const exact = await queryCallInsights({ callId: "call-9" }, NOW, reader);
  const insights = (exact.value as { insights: { recordingId: string; transcript: string }[] })
    .insights;
  assert.equal(insights[0]?.recordingId, "55");
  assert.equal(insights[0]?.transcript.includes("http"), false);

  const summary = lookupVoiceSummary({ voicemail: voicemailRow, insight: insightRow });
  const voicemailSummary = summary.latestVoicemail?.["summary"];
  assert.equal(typeof voicemailSummary, "string");
  assert.equal((voicemailSummary as string).length, 500);
  assert.notEqual(voicemailSummary, long);
  assert.equal(summary.latestCallInsight?.["summary"], "Brake inspection.");
  assert.equal(summary.latestCallInsight?.["hasTranscript"], true);
  assert.equal(JSON.stringify(summary.latestCallInsight).includes("brake brake"), false);

  const rejected = await queryVoicemails({ callId: "call-9" }, NOW, reader);
  assert.equal(rejected.resultCode, "invalid");
});

test("MCP audit keeps callId and drops phone and transcript text", () => {
  const voicemailTool = toolDefinition("boltz_voicemails");
  const insightTool = toolDefinition("boltz_call_insights");
  assert.equal(voicemailTool?.scope, "read");
  assert.equal(insightTool?.scope, "read");
  const summary = summarizeToolArgs({
    phone: CALLER,
    callId: "s-session-1",
    leadId: "00000000-0000-4000-8000-000000000001",
    text: "The brakes feel soft and the transcript must not be audited.",
  });
  assert.equal(summary["callId"], "s-session-1");
  assert.equal(summary["phonePresent"], true);
  assert.equal(Object.hasOwn(summary, "phone"), false);
  assert.equal(JSON.stringify(summary).includes("brakes"), false);
  assert.equal(JSON.stringify(summary).includes("7085550111"), false);
});

test("the sync path does not send SMS or enqueue first touch", () => {
  const server = readFileSync(join(root, "src/server/lead-inbox/voice-intake.server.ts"), "utf8");
  const route = readFileSync(
    join(root, "src/routes/api/public/cron/reconcile-ringcentral-voice.ts"),
    "utf8",
  );
  const functions = readFileSync(join(root, "src/lib/lead-inbox.functions.ts"), "utf8");
  const intake = readFileSync(join(root, "src/server/lead-inbox/voice-intake.ts"), "utf8");
  for (const source of [server, route, intake]) {
    assert.doesNotMatch(
      source,
      /sendSms|sendOutbound|enqueueJob|processJobs|META_AUTO_FIRST_TOUCH/,
    );
    assert.doesNotMatch(source, /process_inbound|process_meta_lead/);
  }
  assert.match(server, /VOICEMAIL_SOURCE/);
  assert.match(server, /getOrCreateLeadThread/);
  assert.doesNotMatch(server, /lifecycle:\s*"/);
  assert.match(route, /authorizeCron/);
  const start = functions.indexOf("export const syncRingCentralVoiceNow = createServerFn");
  const block = functions.slice(start, functions.indexOf("export const ensureSubscription"));
  const gate = block.indexOf('requireCapability(context, "integrations.manage")');
  const work = block.indexOf("runVoiceSync");
  assert.ok(gate >= 0 && work > gate);
});
