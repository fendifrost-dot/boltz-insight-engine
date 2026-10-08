// MCP tool I/O. Sends go through the bot API handler, which owns the shop gates.
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { Constants, type Database } from "@/integrations/supabase/types";
import { validateLifecycleEvidence, type LifecycleEvidence } from "@/lib/lifecycle-transitions";
import { secretStatus } from "@/server/lead-inbox/env.server";
import { handleBotRequest } from "@/server/lead-inbox/bot-api.server";
import { LEAD_SOURCE_PATTERN } from "@/server/lead-inbox/bot-api.policy";
import { applyLifecycleTransition } from "@/server/lead-inbox/lifecycle.server";
import { agentCircuitState, sanitizeLeadUpdates } from "@/server/lead-inbox/jobs.server";
import { cachedCapability } from "@/server/lead-inbox/outbound.server";
import { detectOptOut } from "@/server/lead-inbox/safety.server";
import { addEvent } from "@/server/lead-inbox/store.server";
import { adsConfigError } from "@/server/google-ads/env.server";
import { getAdsWeeklyReport } from "@/server/google-ads/reports.server";
import { pullAdsCallReport } from "@/server/google-ads/call-report.server";
import { isCallWindow, resolveCallWindow } from "@/server/google-ads/call-report";
import {
  executeMcpSend,
  publicSecretFlags,
  redactDigits,
  resultCodeForBotStatus,
  type McpToolRunner,
  type ToolOutcome,
} from "./protocol.ts";

type Lifecycle = Database["public"]["Enums"]["lead_lifecycle"];

const STAFF_EVIDENCE = [
  "customer_message",
  "staff_observation",
  "appointment_record",
  "inspection_record",
  "estimate_record",
  "manual_correction",
] as const;

const LEAD_COLUMNS =
  "id, name, phone_e164, email, consent_status, lifecycle, lead_source, vehicle_year, vehicle_make, vehicle_model, symptoms, notes, last_inbound_at, last_outbound_at, last_message_at, created_at";

const LIST_DEFAULT = 25;
const LIST_MAX = 100;
const SINCE_MAX_MS = 366 * 24 * 60 * 60 * 1000;
const DEFAULT_SINCE_MS = 7 * 24 * 60 * 60 * 1000;

type LeadRecord = {
  id: string;
  name: string | null;
  phone_e164: string | null;
  email: string | null;
  consent_status: string;
  lifecycle: string;
  lead_source: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  symptoms: string | null;
  notes: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
  created_at: string;
};

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

function failed(status: number, body: unknown): ToolOutcome {
  return {
    resultCode: resultCodeForBotStatus(status, body),
    isError: status >= 400,
    value: body,
  };
}

function dbFailed(error: { message: string }): ToolOutcome {
  console.error("[mcp]", error.message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200));
  return { resultCode: "error", isError: true, value: { error: "request failed" } };
}

function publicLead(lead: LeadRecord, notesCap = 2000) {
  const notes = lead.notes ?? "";
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone_e164,
    email: lead.email,
    consentStatus: lead.consent_status,
    lifecycle: lead.lifecycle,
    leadSource: lead.lead_source,
    vehicleYear: lead.vehicle_year,
    vehicleMake: lead.vehicle_make,
    vehicleModel: lead.vehicle_model,
    service: lead.symptoms,
    notes: notes.slice(0, notesCap),
    notesTruncated: notes.length > notesCap,
    lastInboundAt: lead.last_inbound_at,
    lastOutboundAt: lead.last_outbound_at,
    lastMessageAt: lead.last_message_at,
    createdAt: lead.created_at,
  };
}

async function botAction(payload: unknown): Promise<{ status: number; body: unknown }> {
  const response = await handleBotRequest(
    new Request("https://boltz.internal/api/public/bot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = { error: "request failed" };
  }
  return { status: response.status, body };
}

const lookupSchema = z
  .object({
    phone: z.string().min(1).max(40).optional(),
    email: z.string().max(320).optional(),
    leadId: z.string().uuid().optional(),
  })
  .strict()
  .refine((data) => [data.phone, data.email, data.leadId].filter(Boolean).length === 1, {
    message: "Provide exactly one of phone, email, or leadId",
  });

async function leadById(id: string): Promise<LeadRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as LeadRecord | null) ?? null;
}

async function threadForLead(leadId: string): Promise<{
  id: string;
  phone: string;
  controlMode: string;
  lastMessageAt: string | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("message_threads")
    .select("id, phone_e164, control_mode, last_message_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    phone: data.phone_e164,
    controlMode: data.control_mode,
    lastMessageAt: data.last_message_at,
  };
}

async function attachNotes(body: unknown): Promise<unknown> {
  if (!body || typeof body !== "object") return body;
  const record = body as { found?: unknown; lead?: { id?: unknown; notes?: unknown } | null };
  const id = record.lead && typeof record.lead.id === "string" ? record.lead.id : null;
  if (!record.found || !id) return body;
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("notes, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const notes = data?.notes ?? "";
  return {
    ...record,
    lead: {
      ...record.lead,
      notes: notes.slice(0, 2000),
      notesTruncated: notes.length > 2000,
      createdAt: data?.created_at ?? null,
    },
  };
}

async function lookupLead(args: unknown): Promise<ToolOutcome> {
  const parsed = lookupSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.leadId) {
    const lead = await leadById(parsed.data.leadId);
    if (!lead)
      return {
        resultCode: "ok",
        isError: false,
        value: { found: false, matchCount: 0, lead: null, thread: null },
      };
    return {
      resultCode: "ok",
      isError: false,
      value: {
        found: true,
        matchCount: 1,
        lead: publicLead(lead),
        thread: await threadForLead(lead.id),
      },
    };
  }
  const payload = parsed.data.phone
    ? { action: "lookup", phone: parsed.data.phone }
    : { action: "lookup", email: parsed.data.email };
  const result = await botAction(payload);
  if (result.status >= 400) return failed(result.status, result.body);
  return { resultCode: "ok", isError: false, value: await attachNotes(result.body) };
}

const listSchema = z
  .object({
    source: z.string().regex(LEAD_SOURCE_PATTERN).optional(),
    status: z.string().optional(),
    since: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(LIST_MAX).optional(),
  })
  .strict();

function isLifecycle(value: string): value is Lifecycle {
  return (Constants.public.Enums.lead_lifecycle as readonly string[]).includes(value);
}

async function listLeads(args: unknown, now: Date): Promise<ToolOutcome> {
  const parsed = listSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.status !== undefined && !isLifecycle(parsed.data.status)) {
    return {
      resultCode: "invalid",
      isError: true,
      value: { error: "status must be a lead lifecycle value" },
    };
  }
  let sinceMs = now.getTime() - DEFAULT_SINCE_MS;
  if (parsed.data.since !== undefined) {
    sinceMs = Date.parse(parsed.data.since);
    if (Number.isNaN(sinceMs)) {
      return {
        resultCode: "invalid",
        isError: true,
        value: { error: "since must be an ISO timestamp" },
      };
    }
    if (sinceMs > now.getTime() + 5 * 60_000) {
      return { resultCode: "invalid", isError: true, value: { error: "since is in the future" } };
    }
    if (now.getTime() - sinceMs > SINCE_MAX_MS) {
      return {
        resultCode: "invalid",
        isError: true,
        value: { error: "since is older than 366 days" },
      };
    }
  }
  const limit = parsed.data.limit ?? LIST_DEFAULT;
  let query = supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .gte("created_at", new Date(sinceMs).toISOString());
  if (parsed.data.source) query = query.eq("lead_source", parsed.data.source);
  if (parsed.data.status && isLifecycle(parsed.data.status))
    query = query.eq("lifecycle", parsed.data.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit + 1);
  if (error) return dbFailed(error);
  const rows = (data ?? []) as LeadRecord[];
  return {
    resultCode: "ok",
    isError: false,
    value: {
      leads: rows.slice(0, limit).map((row) => publicLead(row, 500)),
      truncated: rows.length > limit,
    },
  };
}

const messagesSchema = z
  .object({
    phone: z.string().min(1).max(40).optional(),
    leadId: z.string().uuid().optional(),
    threadId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.phone) || Boolean(data.leadId) || Boolean(data.threadId), {
    message: "Provide phone, leadId, or threadId",
  });

async function threadMessages(args: unknown): Promise<ToolOutcome> {
  const parsed = messagesSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const payload: Record<string, unknown> = { action: "messages" };
  if (parsed.data.phone !== undefined) payload["phone"] = parsed.data.phone;
  if (parsed.data.leadId !== undefined) payload["leadId"] = parsed.data.leadId;
  if (parsed.data.threadId !== undefined) payload["threadId"] = parsed.data.threadId;
  if (parsed.data.limit !== undefined) payload["limit"] = parsed.data.limit;
  const result = await botAction(payload);
  return failed(result.status, result.body);
}

const inboundSchema = z
  .object({
    since: z.string().min(1).max(40),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

async function inboundSince(args: unknown): Promise<ToolOutcome> {
  const parsed = inboundSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const payload: Record<string, unknown> = { action: "inbound", since: parsed.data.since };
  if (parsed.data.limit !== undefined) payload["limit"] = parsed.data.limit;
  const result = await botAction(payload);
  return failed(result.status, result.body);
}

async function latestInboundIsOptOut(leadId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("body")
    .eq("lead_id", leadId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.body && detectOptOut(data.body));
}

async function leadStatus(args: unknown): Promise<ToolOutcome> {
  const looked = await lookupLead(args);
  if (looked.isError || looked.resultCode !== "ok") return looked;
  const body = looked.value as {
    found?: boolean;
    lead?: {
      id?: string;
      lifecycle?: string;
      consentStatus?: string;
      leadSource?: string | null;
      lastInboundAt?: string | null;
      lastOutboundAt?: string | null;
      lastMessageAt?: string | null;
    } | null;
  };
  if (!body.found || !body.lead?.id) {
    return {
      resultCode: "ok",
      isError: false,
      value: { found: false, leadId: null, optedOut: null },
    };
  }
  const stop = await latestInboundIsOptOut(body.lead.id);
  const optedOut = body.lead.consentStatus === "opted_out" || stop;
  return {
    resultCode: "ok",
    isError: false,
    value: {
      found: true,
      leadId: body.lead.id,
      lifecycle: body.lead.lifecycle ?? null,
      consentStatus: body.lead.consentStatus ?? null,
      optedOut,
      leadSource: body.lead.leadSource ?? null,
      lastInboundAt: body.lead.lastInboundAt ?? null,
      lastOutboundAt: body.lead.lastOutboundAt ?? null,
      lastMessageAt: body.lead.lastMessageAt ?? null,
    },
  };
}

async function integrationHealth(): Promise<ToolOutcome> {
  const [snapshots, subscriptions, jobs, circuit] = await Promise.all([
    supabaseAdmin
      .from("integration_health_snapshots")
      .select("provider, check_name, ok, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    supabaseAdmin
      .from("ringcentral_subscriptions")
      .select("id, status, expires_at, last_renewed_at, last_renewal_error, sms_capability")
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("message_jobs")
      .select("id, job_type, status, attempts, last_error, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    agentCircuitState(),
  ]);
  if (snapshots.error) return dbFailed(snapshots.error);
  if (subscriptions.error) return dbFailed(subscriptions.error);
  if (jobs.error) return dbFailed(jobs.error);

  let capability: { capability: string; detail: string } = {
    capability: "unknown",
    detail: "capability check failed",
  };
  try {
    const result = await cachedCapability();
    capability = { capability: result.capability, detail: redactDigits(result.detail) };
  } catch (error) {
    capability = {
      capability: "unknown",
      detail: redactDigits(error instanceof Error ? error.message : "capability check failed"),
    };
  }

  return {
    resultCode: "ok",
    isError: false,
    value: {
      secrets: publicSecretFlags(secretStatus()),
      circuit: {
        paused: circuit.paused,
        detail: circuit.detail ? redactDigits(circuit.detail) : null,
      },
      capability,
      textingHours: "8:00 AM-9:00 PM America/Chicago",
      snapshots: (snapshots.data ?? []).map((row) => ({
        provider: row.provider,
        checkName: row.check_name,
        ok: row.ok,
        detail: row.detail ? redactDigits(row.detail) : null,
        createdAt: row.created_at,
      })),
      subscriptions: (subscriptions.data ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        expiresAt: row.expires_at,
        lastRenewedAt: row.last_renewed_at,
        smsCapability: row.sms_capability,
        lastRenewalError: row.last_renewal_error ? redactDigits(row.last_renewal_error) : null,
      })),
      jobs: (jobs.data ?? []).map((row) => ({
        id: row.id,
        jobType: row.job_type,
        status: row.status,
        attempts: row.attempts,
        createdAt: row.created_at,
        lastError: row.last_error ? redactDigits(row.last_error) : null,
      })),
    },
  };
}

const daysSchema = z.object({ days: z.number().int().min(1).max(90).optional() }).strict();

async function adsWeekly(args: unknown): Promise<ToolOutcome> {
  const parsed = daysSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const configError = adsConfigError();
  if (configError)
    return { resultCode: "unavailable", isError: true, value: { error: configError } };
  try {
    const report = await getAdsWeeklyReport({ days: parsed.data.days });
    return { resultCode: "ok", isError: false, value: report };
  } catch (error) {
    return {
      resultCode: "error",
      isError: true,
      value: { error: redactDigits(error instanceof Error ? error.message : "ads report failed") },
    };
  }
}

const callsSchema = z
  .object({
    since: z.string().max(40).optional(),
    until: z.string().max(40).optional(),
  })
  .strict();

async function adsCalls(args: unknown, now: Date): Promise<ToolOutcome> {
  const parsed = callsSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const configError = adsConfigError();
  if (configError)
    return { resultCode: "unavailable", isError: true, value: { error: configError } };
  const window = resolveCallWindow({
    since: parsed.data.since ?? null,
    until: parsed.data.until ?? null,
    now,
  });
  if (!isCallWindow(window)) {
    return { resultCode: "invalid", isError: true, value: { error: window.error } };
  }
  try {
    const report = await pullAdsCallReport(window);
    return { resultCode: "ok", isError: false, value: report };
  } catch (error) {
    return {
      resultCode: "error",
      isError: true,
      value: { error: redactDigits(error instanceof Error ? error.message : "ads calls failed") },
    };
  }
}

const updateSchema = z
  .object({
    leadId: z.string().uuid(),
    notes: z.string().min(1).max(2000).optional(),
    lifecycle: z.string().optional(),
    evidence: z
      .object({
        basis: z.enum(STAFF_EVIDENCE),
        evidenceRef: z.string().max(200).optional(),
        note: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((data) => data.notes !== undefined || data.lifecycle !== undefined, {
    message: "Provide notes or lifecycle",
  });

async function updateLead(
  agent: { id: string; name: string },
  args: unknown,
): Promise<ToolOutcome> {
  const parsed = updateSchema.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const lead = await leadById(parsed.data.leadId);
  if (!lead) return { resultCode: "not_found", isError: true, value: { error: "Lead not found" } };

  let lifecycleResult: { applied: boolean; from: string; to: string } | null = null;
  if (parsed.data.lifecycle !== undefined) {
    if (!isLifecycle(parsed.data.lifecycle)) {
      return {
        resultCode: "invalid",
        isError: true,
        value: { error: "lifecycle must be a lead lifecycle value" },
      };
    }
    if (!parsed.data.evidence) {
      return {
        resultCode: "invalid",
        isError: true,
        value: { error: "lifecycle changes require evidence" },
      };
    }
    const evidence: LifecycleEvidence = {
      basis: parsed.data.evidence.basis,
      assertedBy: agent.id,
    };
    if (parsed.data.evidence.evidenceRef !== undefined)
      evidence.evidenceRef = parsed.data.evidence.evidenceRef;
    if (parsed.data.evidence.note !== undefined) evidence.note = parsed.data.evidence.note;
    const evidenceCheck = validateLifecycleEvidence({ actor: "staff", evidence });
    if (!evidenceCheck.ok) {
      return { resultCode: "unprocessable", isError: true, value: { error: evidenceCheck.reason } };
    }
    const transition = await applyLifecycleTransition({
      leadId: lead.id,
      fromLifecycle: lead.lifecycle as Lifecycle,
      toLifecycle: parsed.data.lifecycle,
      actor: `staff:mcp:${agent.name}`,
      evidence,
      summary: `MCP agent ${agent.name} moved lifecycle to ${parsed.data.lifecycle}`,
    });
    if (!transition.ok) {
      const resultCode =
        transition.code === "stale"
          ? "conflict"
          : transition.code === "validation"
            ? "unprocessable"
            : "error";
      return {
        resultCode,
        isError: true,
        value: { error: transition.code === "rpc_error" ? "request failed" : transition.reason },
      };
    }
    lifecycleResult = transition.applied
      ? { applied: true, from: transition.from, to: transition.to }
      : { applied: false, from: lead.lifecycle, to: lead.lifecycle };
  }

  let notesUpdated = false;
  if (parsed.data.notes !== undefined) {
    const updates = sanitizeLeadUpdates({ notes: parsed.data.notes });
    if (!updates["notes"]) {
      return {
        resultCode: "invalid",
        isError: true,
        value: { error: "notes must be 1-2000 characters" },
      };
    }
    const { error } = await supabaseAdmin
      .from("leads")
      .update(updates as never)
      .eq("id", lead.id);
    if (error) return dbFailed(error);
    await addEvent(
      lead.id,
      "lead_fields_updated",
      "MCP agent updated lead notes",
      `bot:${agent.name}`,
      {
        fields: ["notes"],
        notes_length: parsed.data.notes.length,
      },
    );
    notesUpdated = true;
  }

  return {
    resultCode: "ok",
    isError: false,
    value: { ok: true, leadId: lead.id, lifecycle: lifecycleResult, notesUpdated },
  };
}

export function createBoltzMcpTools(): McpToolRunner {
  return {
    async run(ctx) {
      switch (ctx.tool) {
        case "boltz_lookup_lead":
          return lookupLead(ctx.args);
        case "boltz_list_leads":
          return listLeads(ctx.args, ctx.now);
        case "boltz_thread_messages":
          return threadMessages(ctx.args);
        case "boltz_inbound_since":
          return inboundSince(ctx.args);
        case "boltz_lead_status":
          return leadStatus(ctx.args);
        case "boltz_integration_health":
          return integrationHealth();
        case "boltz_ads_weekly":
          return adsWeekly(ctx.args);
        case "boltz_ads_calls":
          return adsCalls(ctx.args, ctx.now);
        case "boltz_send_sms":
          return executeMcpSend({
            agentName: ctx.agent.name,
            input: ctx.args,
            now: ctx.now,
            dispatch: (request) => handleBotRequest(request),
          });
        case "boltz_update_lead":
          return updateLead(ctx.agent, ctx.args);
        default:
          return { resultCode: "unknown_tool", isError: true, value: { error: "unknown tool" } };
      }
    },
  };
}
