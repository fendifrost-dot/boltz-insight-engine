// Bot SMS API. Service role stays on the server. Call only after authorizeBotRequest.
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CONSENT_BASIS,
  buildConsentLeadUpdate,
  validateConsentOptIn,
  type ConsentEvidenceInput,
} from "@/lib/start-owner-sms-policy";
import {
  BOT_DAILY_SMS_CAP_PER_NUMBER,
  BOT_DUPLICATE_BODY_WINDOW_MS,
  BOT_NAME_PATTERN,
  botActor,
  botIdempotencyKey,
  classifyIdempotencyHit,
  evaluateSendGates,
  isSendableE164,
  normalizeEmail,
  parseInboundSince,
  resolveStartLeadSource,
  screenOutboundText,
  type ConsentStatus,
} from "./bot-api.policy";
import { sendOutbound } from "./outbound.server";
import {
  addEvent,
  findMessageByIdempotencyKey,
  getOrCreateLeadThread,
  toE164,
  type LeadRow,
  type ThreadRow,
} from "./store.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_CHARS = 20_000;

const LEAD_COLUMNS =
  "id, name, phone_e164, email, consent_status, lifecycle, lead_source, vehicle_year, vehicle_make, vehicle_model, symptoms, last_inbound_at, last_outbound_at, last_message_at";

type BotLead = {
  id: string;
  name: string | null;
  phone_e164: string | null;
  email: string | null;
  consent_status: ConsentStatus;
  lifecycle: string;
  lead_source: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  symptoms: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
};

type BotThread = {
  id: string;
  lead_id: string;
  phone_e164: string;
  control_mode: string;
  last_message_at: string | null;
};

const consentEvidenceSchema = z.object({
  basis: z.enum(CONSENT_BASIS),
  note: z.string().max(500).optional(),
  evidenceRef: z.string().max(200).optional(),
});

const lookupSchema = z
  .object({
    action: z.literal("lookup"),
    phone: z.string().min(1).max(40).optional(),
    email: z.string().max(320).optional(),
  })
  .refine((data) => Boolean(data.phone) !== Boolean(data.email), {
    message: "Provide phone or email, not both",
  });

const messagesSchema = z
  .object({
    action: z.literal("messages"),
    phone: z.string().min(1).max(40).optional(),
    leadId: z.string().uuid().optional(),
    threadId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .refine((data) => Boolean(data.phone) || Boolean(data.leadId) || Boolean(data.threadId), {
    message: "Provide phone, leadId, or threadId",
  });

const inboundSchema = z.object({
  action: z.literal("inbound"),
  since: z.string().min(1).max(40),
  limit: z.number().int().min(1).max(100).optional(),
});

const sendSchema = z
  .object({
    action: z.literal("send"),
    botName: z.string().regex(BOT_NAME_PATTERN),
    text: z.string().min(1).max(480),
    phone: z.string().min(1).max(40).optional(),
    leadId: z.string().uuid().optional(),
    threadId: z.string().uuid().optional(),
    name: z.string().max(200).optional(),
    email: z.string().max(320).optional(),
    leadSource: z.string().max(100).optional(),
    vehicleYear: z.number().int().min(1900).max(2100).optional(),
    vehicleMake: z.string().max(100).optional(),
    vehicleModel: z.string().max(100).optional(),
    vehicleMileage: z.number().int().min(0).max(2_000_000).optional(),
    service: z.string().max(500).optional(),
    idempotencyKey: z
      .string()
      .regex(/^[A-Za-z0-9:_./-]{8,128}$/)
      .optional(),
    markConsentOptIn: z.boolean().optional(),
    consentEvidence: consentEvidenceSchema.optional(),
  })
  .refine((data) => Boolean(data.phone) || Boolean(data.leadId) || Boolean(data.threadId), {
    message: "Provide phone, leadId, or threadId",
  });

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function invalid(error: z.ZodError): Response {
  return json(
    {
      error: "Invalid request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    400,
  );
}

function publicLead(lead: BotLead) {
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
    lastInboundAt: lead.last_inbound_at,
    lastOutboundAt: lead.last_outbound_at,
    lastMessageAt: lead.last_message_at,
  };
}

function publicThread(thread: BotThread | null) {
  if (!thread) return null;
  return {
    id: thread.id,
    phone: thread.phone_e164,
    controlMode: thread.control_mode,
    lastMessageAt: thread.last_message_at,
  };
}

function asLead(row: LeadRow): BotLead {
  return {
    id: row.id,
    name: row.name,
    phone_e164: row.phone_e164,
    email: row.email,
    consent_status: row.consent_status,
    lifecycle: row.lifecycle,
    lead_source: row.lead_source,
    vehicle_year: row.vehicle_year,
    vehicle_make: row.vehicle_make,
    vehicle_model: row.vehicle_model,
    symptoms: row.symptoms,
    last_inbound_at: row.last_inbound_at,
    last_outbound_at: row.last_outbound_at,
    last_message_at: row.last_message_at,
  };
}

function asThread(row: ThreadRow): BotThread {
  return {
    id: row.id,
    lead_id: row.lead_id,
    phone_e164: row.phone_e164,
    control_mode: row.control_mode,
    last_message_at: row.last_message_at,
  };
}

async function leadById(id: string): Promise<BotLead | null> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as BotLead | null) ?? null;
}

async function threadById(id: string): Promise<BotThread | null> {
  const { data, error } = await supabaseAdmin
    .from("message_threads")
    .select("id, lead_id, phone_e164, control_mode, last_message_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as BotThread | null) ?? null;
}

async function threadForLead(leadId: string): Promise<BotThread | null> {
  const { data, error } = await supabaseAdmin
    .from("message_threads")
    .select("id, lead_id, phone_e164, control_mode, last_message_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as BotThread | null) ?? null;
}

async function findByPhone(
  phone: string,
): Promise<{ lead: BotLead; thread: BotThread | null } | null> {
  const thread = await (async () => {
    const { data, error } = await supabaseAdmin
      .from("message_threads")
      .select("id, lead_id, phone_e164, control_mode, last_message_at")
      .eq("phone_e164", phone)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as BotThread | null) ?? null;
  })();

  if (thread) {
    const lead = await leadById(thread.lead_id);
    if (!lead) return null;
    return { lead, thread };
  }

  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("phone_e164", phone)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const lead = data as BotLead;
  return { lead, thread: await threadForLead(lead.id) };
}

function requirePhone(raw: string): string | Response {
  const phone = toE164(raw);
  if (!isSendableE164(phone)) {
    return json({ error: "Invalid phone number digit count" }, 422);
  }
  return phone;
}

export async function handleBotRequest(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: "Request body is too large" }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { action?: unknown }).action
      : undefined;
  if (action === "lookup") return handleLookup(payload);
  if (action === "shop_chat" || action === "shop_message" || action === "shop_schedule") {
    const { botReadShopChat, botPostShopMessage, botShopSchedule } = await import("@/server/desk/bot-chat.server");
    const { action: _action, botName, ...args } = payload as Record<string, unknown>;
    try {
      if (action === "shop_chat") return json(await botReadShopChat(args));
      if (action === "shop_schedule") return json(await botShopSchedule(args));
      if (typeof botName !== "string" || !BOT_NAME_PATTERN.test(botName)) return json({ error: "Valid botName required" }, 400);
      return json(await botPostShopMessage({ name: botName }, args));
    } catch (error) {
      if (error instanceof z.ZodError) return json({ error: "Invalid shop chat arguments" }, 400);
      throw error;
    }
  }
  if (action === "messages") return handleMessages(payload);
  if (action === "inbound") return handleInbound(payload);
  if (action === "send") return handleSend(payload);
  if (action === "square_revenue" || action === "square_payments") {
    const { handleSquareBotAction } = await import("@/server/square/read.server");
    return handleSquareBotAction(payload);
  }
  return json(
    { error: "action must be lookup, messages, inbound, send, square_revenue, square_payments, shop_chat, shop_message, or shop_schedule" },
    400,
  );
}

async function handleLookup(payload: unknown): Promise<Response> {
  const parsed = lookupSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);

  if (parsed.data.email) {
    const email = normalizeEmail(parsed.data.email);
    if (!email) return json({ error: "Invalid email" }, 422);
    const { count, error: countError } = await supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("email", email);
    if (countError) throw countError;
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select(LEAD_COLUMNS)
      .ilike("email", email)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ found: false, matchCount: 0, lead: null, thread: null });
    const lead = data as BotLead;
    const thread = await threadForLead(lead.id);
    return json({
      found: true,
      matchCount: count ?? 1,
      lead: publicLead(lead),
      thread: publicThread(thread),
    });
  }

  const phone = requirePhone(parsed.data.phone ?? "");
  if (phone instanceof Response) return phone;
  const found = await findByPhone(phone);
  if (!found) return json({ found: false, matchCount: 0, lead: null, thread: null });
  return json({
    found: true,
    matchCount: 1,
    lead: publicLead(found.lead),
    thread: publicThread(found.thread),
  });
}

async function handleMessages(payload: unknown): Promise<Response> {
  const parsed = messagesSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const limit = parsed.data.limit ?? 40;

  let lead: BotLead | null = null;
  let thread: BotThread | null = null;

  if (parsed.data.threadId) {
    thread = await threadById(parsed.data.threadId);
    if (!thread) return json({ error: "Thread not found" }, 404);
    lead = await leadById(thread.lead_id);
    if (!lead) return json({ error: "Lead not found" }, 404);
    if (parsed.data.leadId && parsed.data.leadId !== lead.id) {
      return json({ error: "Thread does not belong to the selected lead" }, 409);
    }
  } else if (parsed.data.leadId) {
    lead = await leadById(parsed.data.leadId);
    if (!lead) return json({ error: "Lead not found" }, 404);
    thread = await threadForLead(lead.id);
  } else {
    const phone = requirePhone(parsed.data.phone ?? "");
    if (phone instanceof Response) return phone;
    const found = await findByPhone(phone);
    if (!found) return json({ error: "Lead not found" }, 404);
    lead = found.lead;
    thread = found.thread;
  }

  if (!thread) {
    return json({ leadId: lead.id, threadId: null, messages: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, direction, body, created_at, delivery_state, provider_created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const messages = (data ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      direction: row.direction,
      body: row.body,
      createdAt: row.created_at,
      status: row.delivery_state,
      providerCreatedAt: row.provider_created_at,
    }));

  return json({ leadId: lead.id, threadId: thread.id, messages });
}

async function handleInbound(payload: unknown): Promise<Response> {
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const since = parseInboundSince(parsed.data.since, Date.now());
  if (!since.ok) return json({ error: since.reason }, 422);

  const limit = parsed.data.limit ?? 50;
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, lead_id, thread_id, body, created_at, sender_e164, delivery_state")
    .eq("direction", "inbound")
    .gt("created_at", new Date(since.sinceMs).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit + 1);
  if (error) throw error;

  const rows = data ?? [];
  const truncated = rows.length > limit;
  const messages = rows.slice(0, limit).map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    threadId: row.thread_id,
    body: row.body,
    createdAt: row.created_at,
    from: row.sender_e164,
    status: row.delivery_state,
  }));
  return json({ messages, truncated });
}

function evidenceOf(
  raw: z.infer<typeof consentEvidenceSchema> | undefined,
): ConsentEvidenceInput | undefined {
  if (!raw) return undefined;
  const evidence: ConsentEvidenceInput = { basis: raw.basis };
  if (raw.note !== undefined) evidence.note = raw.note;
  if (raw.evidenceRef !== undefined) evidence.evidenceRef = raw.evidenceRef;
  return evidence;
}

async function handleSend(payload: unknown): Promise<Response> {
  const parsed = sendSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const email = data.email === undefined ? undefined : normalizeEmail(data.email);
  if (data.email !== undefined && !email) return json({ error: "Invalid email" }, 422);

  const source = resolveStartLeadSource(data.leadSource);
  if (!source.ok) return json({ error: source.reason }, 422);

  const screened = screenOutboundText(data.text);
  if (!screened.ok)
    return json(
      {
        ok: false,
        duplicate: false,
        reason: screened.reason,
        leadId: null,
        threadId: null,
        messageId: null,
      },
      422,
    );

  const evidence = evidenceOf(data.consentEvidence);
  const consent = validateConsentOptIn({
    markConsentOptIn: data.markConsentOptIn === true,
    ...(evidence ? { consentEvidence: evidence } : {}),
  });
  if (!consent.ok) {
    return json(
      {
        ok: false,
        duplicate: false,
        reason: consent.reason,
        leadId: null,
        threadId: null,
        messageId: null,
      },
      422,
    );
  }

  const resolved = await resolveSendTarget(data, source.source);
  if (resolved instanceof Response) return resolved;
  const { lead, thread, startedNewThread } = resolved;

  const expectedPhone = data.phone ? requirePhone(data.phone) : null;
  if (expectedPhone instanceof Response) return expectedPhone;

  const leadPhone = lead.phone_e164 ? toE164(lead.phone_e164) : null;
  const threadPhone = thread.phone_e164 ? toE164(thread.phone_e164) : null;

  const idempotencyKey = botIdempotencyKey({
    botName: data.botName,
    clientKey: data.idempotencyKey,
    phoneE164: leadPhone ?? threadPhone ?? "",
    text: data.text,
    nowMs: Date.now(),
    windowMs: BOT_DUPLICATE_BODY_WINDOW_MS,
  });

  const windowStart = new Date(Date.now() - BOT_DUPLICATE_BODY_WINDOW_MS).toISOString();
  const dayStart = new Date(Date.now() - DAY_MS).toISOString();

  const [existingByKey, identical, outboundCount, latestInbound] = await Promise.all([
    findMessageByIdempotencyKey(idempotencyKey),
    identicalOutbound(thread.id, data.text, windowStart),
    outboundCountSince(thread.id, dayStart),
    latestInboundBody(thread.id),
  ]);

  const idempotencyHit = classifyIdempotencyHit(existingByKey?.thread_id ?? null, thread.id);
  if (idempotencyHit === "other-thread") {
    return json(
      {
        ok: false,
        duplicate: false,
        reason: "Idempotency key already used for a different thread",
        leadId: lead.id,
        threadId: thread.id,
        messageId: null,
      },
      409,
    );
  }

  const decision = evaluateSendGates({
    consentStatus: lead.consent_status,
    latestInboundBody: latestInbound,
    leadPhoneE164: leadPhone,
    threadPhoneE164: threadPhone,
    expectedPhoneE164: expectedPhone,
    threadLeadId: thread.lead_id,
    requestedLeadId: data.leadId ?? null,
    idempotencyKeyAlreadyUsed: idempotencyHit === "same-thread",
    identicalBodyWithinWindow: Boolean(identical),
    outboundCountInWindow: outboundCount,
    dailyCap: BOT_DAILY_SMS_CAP_PER_NUMBER,
  });

  if (decision.kind === "duplicate") {
    return json({
      ok: true,
      duplicate: true,
      reason: null,
      leadId: lead.id,
      threadId: thread.id,
      messageId: existingByKey?.id ?? identical,
    });
  }
  if (decision.kind === "block") {
    return json(
      {
        ok: false,
        duplicate: false,
        reason: decision.reason,
        leadId: lead.id,
        threadId: thread.id,
        messageId: null,
      },
      decision.status,
    );
  }

  const leadUpdate: Record<string, unknown> = {};
  if (data.name?.trim()) leadUpdate["name"] = data.name.trim();
  if (email) leadUpdate["email"] = email;
  if (data.vehicleYear !== undefined) leadUpdate["vehicle_year"] = data.vehicleYear;
  if (data.vehicleMake?.trim()) leadUpdate["vehicle_make"] = data.vehicleMake.trim();
  if (data.vehicleModel?.trim()) leadUpdate["vehicle_model"] = data.vehicleModel.trim();
  if (data.vehicleMileage !== undefined) leadUpdate["vehicle_mileage"] = data.vehicleMileage;
  if (data.service?.trim()) leadUpdate["symptoms"] = data.service.trim();
  if (data.leadSource && !lead.lead_source) leadUpdate["lead_source"] = source.source;

  const actor = botActor(data.botName);
  const consentUpdate = buildConsentLeadUpdate({
    markConsentOptIn: data.markConsentOptIn === true,
    consentEvidence: evidence,
    leadSource: source.source,
    actorUserId: actor,
    currentConsentStatus: lead.consent_status,
  });
  if (consentUpdate) Object.assign(leadUpdate, consentUpdate);

  if (Object.keys(leadUpdate).length > 0) {
    const { error } = await supabaseAdmin
      .from("leads")
      .update(leadUpdate as never)
      .eq("id", lead.id);
    if (error) throw error;
  }
  if (consentUpdate) {
    await addEvent(lead.id, "consent_opted_in", "SMS consent marked opted in by bot", actor, {
      basis: evidence?.basis,
      evidence_ref: evidence?.evidenceRef ?? null,
      lead_source: source.source,
      bot_name: data.botName,
    });
  }

  if (startedNewThread) {
    const { error } = await supabaseAdmin
      .from("message_threads")
      .update({ control_mode: "human" })
      .eq("id", thread.id);
    if (error) throw error;
    await addEvent(
      lead.id,
      "bot_outbound_started",
      `Bot ${data.botName} started outbound SMS thread`,
      actor,
      {
        thread_id: thread.id,
        text_length: data.text.length,
        bot_name: data.botName,
        consent_status: consentUpdate ? "opted_in" : lead.consent_status,
      },
    );
  }

  const outcome = await sendOutbound({
    leadId: lead.id,
    threadId: thread.id,
    to: leadPhone ?? thread.phone_e164,
    text: data.text,
    idempotencyKey,
    actor,
    eventMetadata: { bot_name: data.botName },
  });

  if (!outcome.ok) {
    const policy = outcome.reason.startsWith("Blocked by outbound");
    return json(
      {
        ok: false,
        duplicate: false,
        reason: outcome.reason,
        leadId: lead.id,
        threadId: thread.id,
        messageId: null,
      },
      policy ? 422 : 502,
    );
  }

  return json({
    ok: true,
    duplicate: outcome.duplicate,
    reason: null,
    leadId: lead.id,
    threadId: thread.id,
    messageId: outcome.message?.id ?? null,
  });
}

async function resolveSendTarget(
  data: z.infer<typeof sendSchema>,
  leadSource: string,
): Promise<{ lead: BotLead; thread: BotThread; startedNewThread: boolean } | Response> {
  if (data.threadId) {
    const thread = await threadById(data.threadId);
    if (!thread) return json({ error: "Thread not found" }, 404);
    const lead = await leadById(thread.lead_id);
    if (!lead) return json({ error: "Lead not found" }, 404);
    return { lead, thread, startedNewThread: false };
  }

  if (data.leadId) {
    const lead = await leadById(data.leadId);
    if (!lead) return json({ error: "Lead not found" }, 404);
    const existing = await threadForLead(lead.id);
    if (existing) return { lead, thread: existing, startedNewThread: false };
    if (!lead.phone_e164) {
      return json(
        {
          ok: false,
          duplicate: false,
          reason: "Lead has no phone number",
          leadId: lead.id,
          threadId: null,
          messageId: null,
        },
        422,
      );
    }
    const created = await getOrCreateLeadThread(lead.phone_e164, leadSource);
    if (created.lead.id !== lead.id) {
      return json(
        {
          ok: false,
          duplicate: false,
          reason: "Thread does not belong to the selected lead — send blocked",
          leadId: lead.id,
          threadId: created.thread.id,
          messageId: null,
        },
        409,
      );
    }
    return { lead: asLead(created.lead), thread: asThread(created.thread), startedNewThread: true };
  }

  const phone = requirePhone(data.phone ?? "");
  if (phone instanceof Response) return phone;
  const before = await findByPhone(phone);
  const created = await getOrCreateLeadThread(phone, leadSource);
  return {
    lead: asLead(created.lead),
    thread: asThread(created.thread),
    startedNewThread: !before?.thread,
  };
}

async function latestInboundBody(threadId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("body")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.body ?? null;
}

async function outboundCountSince(threadId: string, sinceIso: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("direction", "outbound")
    .neq("delivery_state", "failed")
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

async function identicalOutbound(
  threadId: string,
  text: string,
  sinceIso: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("thread_id", threadId)
    .eq("direction", "outbound")
    .eq("body", text)
    .neq("delivery_state", "failed")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
