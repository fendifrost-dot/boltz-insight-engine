// Pure gates for the bot SMS API. No database, no secret values logged.
import { secretEqual } from "./env.server.ts";
import { describeOutboundBlock, detectOptOut, validateOutbound } from "./safety.server.ts";
import { CONSENT_BASIS } from "../../lib/start-owner-sms-policy.ts";
import { createHash } from "node:crypto";

/** Header bots send. Not Authorization, so CRON_SECRET cannot authenticate here. */
export const BOT_API_HEADER = "x-bot-api-secret";

export const BOT_API_SECRET_NAME = "BOT_API_SECRET" as const;

/** Rolling 24h cap of outbound texts to one number. Change this constant to retune. */
export const BOT_DAILY_SMS_CAP_PER_NUMBER = 20;

/** Identical body to the same number inside this window is treated as a retry. */
export const BOT_DUPLICATE_BODY_WINDOW_MS = 10 * 60 * 1000;

export const BOT_INBOUND_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_PRESENTED_SECRET_LENGTH = 256;

export const BOT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export const LEAD_SOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _.:-]{0,99}$/;

/** 10–15 digits, E.164, matching the owner start-SMS digit check and the thread CHECK. */
const SENDABLE_E164 = /^\+[1-9]\d{9,14}$/;

export type ConsentStatus = "unknown" | "opted_in" | "opted_out";

export function botActor(botName: string): string {
  return `bot:${botName}`;
}

export function isSendableE164(phone: string): boolean {
  return SENDABLE_E164.test(phone);
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 320) return null;
  // Backslash is rejected so a lookup pattern cannot change the LIKE escape.
  if (email.includes("\\") || /[\s<>]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Escape LIKE metacharacters. `_` and `%` are valid in an email and must not
 * widen an ilike lookup. The backslash is the default PostgreSQL LIKE escape.
 */
export function emailLookupPattern(email: string): string {
  return email.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const SEND_FIELDS = new Set([
  "action",
  "botName",
  "text",
  "phone",
  "leadId",
  "threadId",
  "name",
  "email",
  "leadSource",
  "vehicleYear",
  "vehicleMake",
  "vehicleModel",
  "vehicleMileage",
  "service",
  "idempotencyKey",
  "markConsentOptIn",
  "consentEvidence",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function looseE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const e164 = digits.startsWith("+")
    ? digits
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? `+${digits}`
        : `+${digits}`;
  return isSendableE164(e164) ? e164 : null;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Optional profile fields must not reject the SMS. Invalid ones are removed
 * and named in warnings. Phone is removed only when a lead or thread id can
 * still address the text.
 */
export function prepareSendPayload(input: unknown): { value: unknown; warnings: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { value: input, warnings: [] };
  }
  const value: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const warnings: string[] = [];
  const drop = (field: string, reason: string) => {
    delete value[field];
    warnings.push(`Dropped ${field} because ${reason}`);
  };

  for (const key of Object.keys(value)) {
    if (!SEND_FIELDS.has(key)) drop(key, "it is not a send field");
  }

  if ("email" in value) {
    const email = typeof value["email"] === "string" ? normalizeEmail(value["email"]) : null;
    if (!email) drop("email", "it is not a valid address");
    else value["email"] = email;
  }

  if ("name" in value) {
    const name = boundedString(value["name"], 200);
    if (!name) drop("name", "it is not valid");
    else value["name"] = name;
  }

  if ("leadSource" in value) {
    const source = boundedString(value["leadSource"], 100);
    if (!source || !LEAD_SOURCE_PATTERN.test(source)) {
      drop("leadSource", "it is not a valid source label");
    } else value["leadSource"] = source;
  }

  if ("vehicleYear" in value) {
    const year = boundedInt(value["vehicleYear"], 1900, 2100);
    if (year === null) drop("vehicleYear", "it is not valid");
    else value["vehicleYear"] = year;
  }

  if ("vehicleMake" in value) {
    const make = boundedString(value["vehicleMake"], 100);
    if (!make) drop("vehicleMake", "it is not valid");
    else value["vehicleMake"] = make;
  }

  if ("vehicleModel" in value) {
    const model = boundedString(value["vehicleModel"], 100);
    if (!model) drop("vehicleModel", "it is not valid");
    else value["vehicleModel"] = model;
  }

  if ("vehicleMileage" in value) {
    const mileage = boundedInt(value["vehicleMileage"], 0, 2_000_000);
    if (mileage === null) drop("vehicleMileage", "it is not valid");
    else value["vehicleMileage"] = mileage;
  }

  if ("service" in value) {
    const service = boundedString(value["service"], 500);
    if (!service) drop("service", "it is not valid");
    else value["service"] = service;
  }

  if ("phone" in value) {
    const hasOtherTarget = isUuid(value["leadId"]) || isUuid(value["threadId"]);
    const phone = typeof value["phone"] === "string" ? looseE164(value["phone"]) : null;
    if (!phone && hasOtherTarget) drop("phone", "it is not a valid phone number");
  }

  if ("consentEvidence" in value) {
    const evidence = value["consentEvidence"];
    const basis =
      evidence && typeof evidence === "object" && !Array.isArray(evidence)
        ? (evidence as Record<string, unknown>)["basis"]
        : undefined;
    const basisOk =
      typeof basis === "string" && (CONSENT_BASIS as readonly string[]).includes(basis);
    const note =
      evidence && typeof evidence === "object"
        ? (evidence as Record<string, unknown>)["note"]
        : undefined;
    const evidenceRef =
      evidence && typeof evidence === "object"
        ? (evidence as Record<string, unknown>)["evidenceRef"]
        : undefined;
    const noteOk = note === undefined || (typeof note === "string" && note.length <= 500);
    const refOk =
      evidenceRef === undefined || (typeof evidenceRef === "string" && evidenceRef.length <= 200);
    if (!basisOk || !noteOk || !refOk) drop("consentEvidence", "it is not valid");
  }

  if (value["markConsentOptIn"] === true && !("consentEvidence" in value)) {
    drop("markConsentOptIn", "consent evidence was missing or invalid");
  } else if ("markConsentOptIn" in value && typeof value["markConsentOptIn"] !== "boolean") {
    drop("markConsentOptIn", "it is not valid");
  }

  return { value, warnings };
}

export function resolveStartLeadSource(
  raw: string | undefined,
): { ok: true; source: string } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim().length === 0) return { ok: true, source: "bot_outbound" };
  const source = raw.trim();
  if (!LEAD_SOURCE_PATTERN.test(source)) return { ok: false, reason: "Invalid lead source" };
  return { ok: true, source };
}

export function screenOutboundText(text: string): { ok: true } | { ok: false; reason: string } {
  const check = validateOutbound(text);
  if (!check.ok) return { ok: false, reason: describeOutboundBlock(check) };
  return { ok: true };
}

export function readPresentedBotSecret(request: Request): string {
  return (request.headers.get(BOT_API_HEADER) ?? "").trim();
}

/**
 * 503 when the server secret is missing, 401 otherwise.
 * Comparison uses secretEqual (SHA-256 + timingSafeEqual). The header value
 * is never copied into the response.
 */
export function authorizeBotRequest(
  request: Request,
  configuredSecret: string | undefined,
): Response | null {
  if (!configuredSecret) {
    return Response.json(
      { error: "Bot API secret not configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const presented = readPresentedBotSecret(request);
  if (presented.length > MAX_PRESENTED_SECRET_LENGTH || !secretEqual(presented, configuredSecret)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}

export type SendGateInput = {
  consentStatus: ConsentStatus;
  latestInboundBody: string | null;
  leadPhoneE164: string | null;
  threadPhoneE164: string | null;
  expectedPhoneE164: string | null;
  threadLeadId: string | null;
  requestedLeadId: string | null;
  idempotencyKeyAlreadyUsed: boolean;
  identicalBodyWithinWindow: boolean;
  outboundCountInWindow: number;
  dailyCap: number;
};

export type SendGateDecision =
  | { kind: "allow" }
  | { kind: "duplicate" }
  | { kind: "block"; status: 403 | 409 | 422 | 429; reason: string };

export function evaluateSendGates(input: SendGateInput): SendGateDecision {
  if (input.threadLeadId && input.requestedLeadId && input.threadLeadId !== input.requestedLeadId) {
    return {
      kind: "block",
      status: 409,
      reason: "Thread does not belong to the selected lead — send blocked",
    };
  }
  if (!input.leadPhoneE164) {
    return { kind: "block", status: 422, reason: "Lead has no phone number" };
  }
  if (input.threadPhoneE164 && input.threadPhoneE164 !== input.leadPhoneE164) {
    return {
      kind: "block",
      status: 409,
      reason: "Lead phone and thread phone disagree — send blocked",
    };
  }
  if (input.expectedPhoneE164 && input.expectedPhoneE164 !== input.leadPhoneE164) {
    return {
      kind: "block",
      status: 409,
      reason: "Destination phone does not match the visible conversation — send blocked",
    };
  }
  if (input.idempotencyKeyAlreadyUsed || input.identicalBodyWithinWindow) {
    return { kind: "duplicate" };
  }
  const optedOut =
    input.consentStatus === "opted_out" ||
    (input.latestInboundBody !== null && detectOptOut(input.latestInboundBody));
  if (optedOut) {
    return { kind: "block", status: 403, reason: "Lead has opted out of texts" };
  }
  if (input.outboundCountInWindow >= input.dailyCap) {
    return { kind: "block", status: 429, reason: "Daily SMS cap reached for this number" };
  }
  return { kind: "allow" };
}

/** A key already stored on another thread must not be treated as a successful retry. */
export function classifyIdempotencyHit(
  existingThreadId: string | null,
  currentThreadId: string,
): "none" | "same-thread" | "other-thread" {
  if (!existingThreadId) return "none";
  return existingThreadId === currentThreadId ? "same-thread" : "other-thread";
}

export function botIdempotencyKey(args: {
  botName: string;
  clientKey: string | undefined;
  phoneE164: string;
  text: string;
  nowMs: number;
  windowMs: number;
}): string {
  if (args.clientKey) return `bot:${args.botName}:${args.clientKey}`;
  const digest = createHash("sha256")
    .update(`${args.phoneE164}\n${args.text}`)
    .digest("hex")
    .slice(0, 32);
  const bucket = Math.floor(args.nowMs / args.windowMs);
  return `bot:${args.botName}:body:${digest}:${bucket}`;
}

export function parseInboundSince(
  iso: string,
  nowMs: number,
): { ok: true; sinceMs: number } | { ok: false; reason: string } {
  const sinceMs = Date.parse(iso);
  if (Number.isNaN(sinceMs)) return { ok: false, reason: "since must be an ISO timestamp" };
  if (sinceMs > nowMs + 5 * 60_000) return { ok: false, reason: "since is in the future" };
  if (nowMs - sinceMs > BOT_INBOUND_MAX_LOOKBACK_MS) {
    return { ok: false, reason: "since is older than 30 days" };
  }
  return { ok: true, sinceMs };
}
