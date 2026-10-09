// Pure MCP protocol, auth helpers, and send guards. No database and no secrets.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SERVER_NAME = "boltz-insight";
export const SERVER_VERSION = "1.0.0";

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const LATEST_PROTOCOL_VERSION = "2025-06-18";

export const TEXTING_TIME_ZONE = "America/Chicago";
/** Inclusive. 8 means 8:00 AM local. */
export const TEXTING_START_HOUR = 8;
/** Exclusive. 21 means 9:00 PM local is outside the window. */
export const TEXTING_END_HOUR = 21;

export const QUIET_HOURS_REASON =
  "Outside shop texting hours (8:00 AM-9:00 PM America/Chicago). No text was sent.";

export const MCP_SCOPES = ["read", "send", "leads.write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const RESULT_CODE_RE = /^[a-z0-9_]{1,40}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const TOKEN_MIN = 20;
const TOKEN_MAX = 256;

const DUMMY_HASH = "0".repeat(64);

export const INSTRUCTIONS = [
  "Boltz Insight Engine MCP. Read leads and threads, and send SMS only through the shop send path.",
  "Every authenticated call is audited before it runs. Audit rows do not store message bodies or phone numbers.",
  "Sends refuse opted-out numbers, keep the 20-text daily cap, and refuse texts outside 8:00 AM-9:00 PM America/Chicago.",
  "botName must match this credential's agent name. idempotencyKey is required.",
  "A read scope cannot send or change a lead. leads.write cannot send SMS and cannot mark a lead Paid.",
  "Square revenue and payment reads are under the read scope. They do not create payments or invoices.",
].join(" ");

export interface McpAgent {
  id: string;
  name: string;
  secretHash: string;
  scopes: string[];
  revokedAt: string | null;
  expiresAt: string | null;
}

export interface AuditWrite {
  agentId: string;
  tool: string;
  argsSummary: Record<string, unknown>;
  resultCode: string;
}

export interface McpStore {
  findAgentByHash(secretHash: string): Promise<McpAgent | null>;
  insertAudit(row: AuditWrite): Promise<{ id: string } | { error: string }>;
  finishAudit(id: string, resultCode: string): Promise<void>;
}

export interface ToolOutcome {
  resultCode: string;
  isError: boolean;
  value: unknown;
}

export interface McpToolContext {
  agent: McpAgent;
  tool: string;
  args: Record<string, unknown>;
  now: Date;
}

export interface McpToolRunner {
  run(ctx: McpToolContext): Promise<ToolOutcome>;
}

export interface ToolDef {
  name: string;
  scope: McpScope | null;
  description: string;
  inputSchema: Record<string, unknown>;
}

const uuidSchema = { type: "string", format: "uuid" };

export const TOOLS: readonly ToolDef[] = [
  {
    name: "boltz_whoami",
    scope: null,
    description: "The agent name and scopes for this credential. Does not return the token.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "boltz_lookup_lead",
    scope: "read",
    description: "Find one lead by phone, email, or lead id, plus its thread when one exists.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        phone: { type: "string" },
        email: { type: "string" },
        leadId: uuidSchema,
      },
    },
  },
  {
    name: "boltz_list_leads",
    scope: "read",
    description:
      "Recent leads. Filter by lead source, lifecycle status, and created-at since. Default window is 7 days.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string" },
        status: { type: "string", description: "Lead lifecycle value, such as New or Contacted." },
        since: { type: "string", description: "ISO timestamp. Leads created after this moment." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "boltz_thread_messages",
    scope: "read",
    description:
      "Messages on one thread, oldest first within the latest limit. Provide phone, leadId, or threadId.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        phone: { type: "string" },
        leadId: uuidSchema,
        threadId: uuidSchema,
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "boltz_inbound_since",
    scope: "read",
    description: "Inbound SMS since an ISO timestamp, exclusive, at most 30 days back.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["since"],
      properties: {
        since: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "boltz_lead_status",
    scope: "read",
    description:
      "Lifecycle, consent, and whether the lead is opted out (consent or a latest inbound STOP). Provide phone, email, or leadId.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        phone: { type: "string" },
        email: { type: "string" },
        leadId: uuidSchema,
      },
    },
  },
  {
    name: "boltz_integration_health",
    scope: "read",
    description:
      "Integration health: which server secrets are configured (never their values), recent checks, and SMS capability.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "boltz_ads_weekly",
    scope: "read",
    description: "The existing read-only Google Ads weekly report. days is 1-90 and defaults to 7.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { days: { type: "integer", minimum: 1, maximum: 90 } },
    },
  },
  {
    name: "boltz_ads_calls",
    scope: "read",
    description:
      "The existing Google Ads call report. Omit since and until for the last full Monday-Sunday week in America/Chicago. Dates are YYYY-MM-DD.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        since: { type: "string" },
        until: { type: "string" },
      },
    },
  },
  {
    name: "boltz_square_revenue",
    scope: "read",
    description:
      "Square revenue rollups for a date range. Dates are YYYY-MM-DD week starts. Returns gross, net, refunds, ticket count, average ticket, and lead-attributed gross by source. Does not return customer names, phones, or emails.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        since: { type: "string", description: "Inclusive YYYY-MM-DD week start." },
        until: { type: "string", description: "Inclusive YYYY-MM-DD week start." },
      },
    },
  },
  {
    name: "boltz_square_payments",
    scope: "read",
    description:
      "Recent Square payments, or the payments linked to one leadId. Amounts, status, match, card brand, and last 4 only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        leadId: uuidSchema,
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "boltz_send_sms",
    scope: "send",
    description:
      "Send one SMS through the shop send path. Requires botName (must match this agent) and idempotencyKey. Refuses opted-out numbers, the daily cap (20 per number), banned wording, texts over 480 characters, and texts outside 8:00 AM-9:00 PM America/Chicago.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["botName", "idempotencyKey", "text"],
      properties: {
        botName: { type: "string" },
        idempotencyKey: { type: "string" },
        text: { type: "string", maxLength: 480 },
        phone: { type: "string" },
        leadId: uuidSchema,
        threadId: uuidSchema,
        name: { type: "string" },
        email: { type: "string" },
        leadSource: { type: "string" },
        vehicleYear: { type: "integer" },
        vehicleMake: { type: "string" },
        vehicleModel: { type: "string" },
        vehicleMileage: { type: "integer" },
        service: { type: "string" },
        markConsentOptIn: { type: "boolean" },
        consentEvidence: { type: "object" },
      },
    },
  },
  {
    name: "boltz_update_lead",
    scope: "leads.write",
    description:
      "Update lead notes and/or lifecycle using the staff lifecycle rules. Cannot mark a lead Paid. Notes replace the existing notes and are capped at 2000 characters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["leadId"],
      properties: {
        leadId: uuidSchema,
        notes: { type: "string", maxLength: 2000 },
        lifecycle: { type: "string" },
        evidence: {
          type: "object",
          properties: {
            basis: { type: "string" },
            evidenceRef: { type: "string" },
            note: { type: "string" },
          },
        },
      },
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Compare two SHA-256 hex digests in constant time. Invalid digests never match. */
export function hashEquals(storedHex: string, computedHex: string): boolean {
  const storedOk = SHA256_HEX_RE.test(storedHex);
  const computedOk = SHA256_HEX_RE.test(computedHex);
  const left = Buffer.from(storedOk ? storedHex : DUMMY_HASH, "hex");
  const right = Buffer.from(computedOk ? computedHex : DUMMY_HASH, "hex");
  const equal = timingSafeEqual(left, right);
  return storedOk && computedOk && equal;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

export function tokenShapeOk(token: string): boolean {
  return token.length >= TOKEN_MIN && token.length <= TOKEN_MAX && !looksLikeJwt(token);
}

export function zonedHour(now: Date, timeZone = TEXTING_TIME_ZONE): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const raw = formatted.find((part) => part.type === "hour")?.value ?? "";
  const hour = Number(raw);
  if (!Number.isInteger(hour)) return -1;
  return hour === 24 ? 0 : hour;
}

export function isWithinTextingHours(now: Date, timeZone = TEXTING_TIME_ZONE): boolean {
  const hour = zonedHour(now, timeZone);
  return hour >= TEXTING_START_HOUR && hour < TEXTING_END_HOUR;
}

const SUMMARY_KEYS = [
  "leadId",
  "threadId",
  "limit",
  "since",
  "until",
  "days",
  "source",
  "status",
  "lifecycle",
  "botName",
  "idempotencyKey",
  "markConsentOptIn",
] as const;

const FORBIDDEN_SUMMARY_KEYS = [
  "phone",
  "email",
  "text",
  "body",
  "name",
  "notes",
  "from",
  "service",
];

/** Args stored on the audit row. Message bodies and phone numbers are not copied. */
export function summarizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (typeof args["text"] === "string") summary["textLength"] = args["text"].length;
  if (typeof args["body"] === "string") summary["bodyLength"] = args["body"].length;
  if (typeof args["notes"] === "string") summary["notesLength"] = args["notes"].length;
  if ("phone" in args)
    summary["phonePresent"] = typeof args["phone"] === "string" && args["phone"] !== "";
  if ("email" in args)
    summary["emailPresent"] = typeof args["email"] === "string" && args["email"] !== "";
  if ("name" in args)
    summary["namePresent"] = typeof args["name"] === "string" && args["name"] !== "";

  for (const key of SUMMARY_KEYS) {
    if (!(key in args)) continue;
    const value = args[key];
    if (typeof value === "string") {
      summary[key] = value.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 80);
    } else if (typeof value === "number" || typeof value === "boolean") {
      summary[key] = value;
    }
  }

  const evidence = args["consentEvidence"] ?? args["evidence"];
  if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    const basis = (evidence as Record<string, unknown>)["basis"];
    if (typeof basis === "string") summary["basis"] = basis.slice(0, 40);
    summary["evidencePresent"] = true;
  }

  for (const key of FORBIDDEN_SUMMARY_KEYS) {
    if (key in summary) delete summary[key];
  }
  return summary;
}

export function safeResultCode(code: string): string {
  return RESULT_CODE_RE.test(code) ? code : "error";
}

export function negotiatedProtocol(requested: unknown): string | null {
  if (typeof requested !== "string") return null;
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : null;
}

export function toolsForScopes(scopes: readonly string[]): ToolDef[] {
  return TOOLS.filter((tool) => tool.scope === null || scopes.includes(tool.scope));
}

export function toolDefinition(name: string): ToolDef | null {
  return TOOL_BY_NAME.get(name) ?? null;
}

export function agentMayCall(agent: McpAgent, tool: ToolDef): boolean {
  if (tool.scope === null) return true;
  return agent.scopes.includes(tool.scope);
}

export function agentIsActive(agent: McpAgent, now: Date): "active" | "revoked" | "expired" {
  if (agent.revokedAt) return "revoked";
  if (agent.expiresAt) {
    const expiresMs = Date.parse(agent.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) return "expired";
  }
  if (!AGENT_NAME_RE.test(agent.name)) return "revoked";
  return "active";
}

export function resultCodeForBotStatus(status: number, body: unknown): string {
  if (status >= 200 && status < 300) {
    if (body && typeof body === "object" && (body as { duplicate?: unknown }).duplicate === true) {
      return "duplicate";
    }
    return "ok";
  }
  if (status === 403) return "opted_out";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "unprocessable";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid";
  if (status === 503) return "unavailable";
  return "error";
}

export function publicSecretFlags(
  rows: { name: string; configured: boolean; masked?: string | null }[],
): { name: string; configured: boolean }[] {
  return rows.map((row) => ({ name: row.name, configured: row.configured }));
}

const sendArgsSchema = z
  .object({
    botName: z.string().regex(AGENT_NAME_RE),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9:_./-]{8,128}$/),
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
    markConsentOptIn: z.boolean().optional(),
    consentEvidence: z
      .object({
        basis: z.string().min(1).max(80),
        note: z.string().max(500).optional(),
        evidenceRef: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((data) => Boolean(data.phone) || Boolean(data.leadId) || Boolean(data.threadId), {
    message: "Provide phone, leadId, or threadId",
  });

function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Quiet hours and required idempotency run here.
 * Opt-out, the daily cap, wording, mismatch, and idempotency replay run in the
 * bot send handler passed as dispatch (handleBotRequest).
 */
export async function executeMcpSend(args: {
  agentName: string;
  input: unknown;
  now: Date;
  dispatch: (request: Request) => Promise<Response>;
}): Promise<ToolOutcome> {
  const parsed = sendArgsSchema.safeParse(args.input);
  if (!parsed.success) {
    return {
      resultCode: "invalid",
      isError: true,
      value: { ok: false, error: "Invalid arguments", issues: issuesOf(parsed.error) },
    };
  }
  if (parsed.data.botName !== args.agentName) {
    return {
      resultCode: "forbidden",
      isError: true,
      value: { ok: false, error: "botName must match the agent credential" },
    };
  }
  if (!isWithinTextingHours(args.now)) {
    return {
      resultCode: "quiet_hours",
      isError: true,
      value: { ok: false, code: "quiet_hours", error: QUIET_HOURS_REASON },
    };
  }

  const data = parsed.data;
  const payload: Record<string, unknown> = {
    action: "send",
    botName: data.botName,
    text: data.text,
    idempotencyKey: data.idempotencyKey,
  };
  if (data.phone !== undefined) payload["phone"] = data.phone;
  if (data.leadId !== undefined) payload["leadId"] = data.leadId;
  if (data.threadId !== undefined) payload["threadId"] = data.threadId;
  if (data.name !== undefined) payload["name"] = data.name;
  if (data.email !== undefined) payload["email"] = data.email;
  if (data.leadSource !== undefined) payload["leadSource"] = data.leadSource;
  if (data.vehicleYear !== undefined) payload["vehicleYear"] = data.vehicleYear;
  if (data.vehicleMake !== undefined) payload["vehicleMake"] = data.vehicleMake;
  if (data.vehicleModel !== undefined) payload["vehicleModel"] = data.vehicleModel;
  if (data.vehicleMileage !== undefined) payload["vehicleMileage"] = data.vehicleMileage;
  if (data.service !== undefined) payload["service"] = data.service;
  if (data.markConsentOptIn !== undefined) payload["markConsentOptIn"] = data.markConsentOptIn;
  if (data.consentEvidence !== undefined) payload["consentEvidence"] = data.consentEvidence;

  const response = await args.dispatch(
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
    body = { ok: false, error: "Send path returned a non-JSON response" };
  }
  const resultCode = resultCodeForBotStatus(response.status, body);
  return { resultCode, isError: response.status >= 400, value: body };
}

export function redactDigits(value: string): string {
  return value.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 300);
}
