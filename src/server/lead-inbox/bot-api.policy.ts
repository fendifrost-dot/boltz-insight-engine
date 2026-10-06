// Pure gates for the bot SMS API. No database, no secret values logged.
import { secretEqual } from "./env.server.ts";
import { describeOutboundBlock, detectOptOut, validateOutbound } from "./safety.server.ts";
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
  if (email.includes("%") || email.includes("_") || email.includes("\\")) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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
