// RingCentral REST adapter. Server-only: never call from the browser.
import {
  callLogRequestPath,
  parseRingCentralError,
  type CallLogPageQuery,
  type RawCallRecord,
} from "./call-log.ts";
import { readSecret, requireSecret } from "./env.server.ts";

type TokenCache = { token: string; expiresAt: number; scopes: string[] };
let tokenCache: TokenCache | undefined;

export class RingCentralHttpError extends Error {
  readonly status: number;
  readonly errorCode: string | null;
  readonly permissionNames: string[];

  constructor(path: string, status: number, body: string) {
    const parsed = parseRingCentralError(body);
    const safePath = path.split("?")[0] ?? path;
    super(`RingCentral ${safePath} failed (${status}): ${redact(body)}`);
    this.name = "RingCentralHttpError";
    this.status = status;
    this.errorCode = parsed.errorCode;
    this.permissionNames = parsed.permissionNames;
  }
}

function baseUrl(): string {
  return requireSecret("RINGCENTRAL_SERVER_URL").replace(/\/+$/, "");
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope.split(/\s+/).filter((part) => part.length > 0 && part.length < 80);
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const clientId = requireSecret("RINGCENTRAL_CLIENT_ID");
  const clientSecret = requireSecret("RINGCENTRAL_CLIENT_SECRET");
  const jwt = requireSecret("RINGCENTRAL_JWT");

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const res = await fetch(`${baseUrl()}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    throw new RingCentralHttpError("/restapi/oauth/token", res.status, await res.text());
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!json.access_token)
    throw new Error("RingCentral token response did not include an access token");
  tokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
    scopes: parseScopes(json.scope),
  };
  return tokenCache.token;
}

/** Permission names from the current JWT, such as SMS or ReadCallLog. Never the token. */
export async function grantedScopes(): Promise<string[]> {
  await getAccessToken();
  return tokenCache?.scopes ?? [];
}

async function rcFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${baseUrl()}${path}`, { ...init, headers });
}

async function rcJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await rcFetch(path, init);
  const text = await res.text();
  if (!res.ok) throw new RingCentralHttpError(path, res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Strip anything token-shaped out of provider error text before logging. */
export function redact(text: string): string {
  return text
    .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token":"[redacted]"')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-jwt]")
    .slice(0, 800);
}

export type SmsCapability = "SmsSender" | "A2PSmsSender" | "none" | "unknown";

export async function resolveSmsCapability(): Promise<{
  capability: SmsCapability;
  fromNumberConfigured: boolean;
  detail: string;
}> {
  const from = readSecret("RINGCENTRAL_FROM_NUMBER");
  const data = await rcJson<{
    records?: { phoneNumber?: string; features?: string[] }[];
  }>("/restapi/v1.0/account/~/extension/~/phone-number?perPage=100");

  const records = data.records ?? [];
  const match = from ? records.find((r) => r.phoneNumber === from) : undefined;
  const features = match?.features ?? [];

  let capability: SmsCapability = "none";
  if (features.includes("A2PSmsSender")) capability = "A2PSmsSender";
  else if (features.includes("SmsSender")) capability = "SmsSender";

  return {
    capability: match ? capability : "unknown",
    fromNumberConfigured: Boolean(from),
    detail: match
      ? `Configured number supports: ${features.join(", ") || "no SMS features"}`
      : "Configured from-number was not found on this RingCentral extension",
  };
}

export type SendSmsResult = {
  providerMessageId: string | null;
  providerCreatedAt: string | null;
  deliveryState: "sent" | "queued";
  raw: Record<string, unknown>;
};

export async function sendSms(args: {
  to: string;
  text: string;
  capability: SmsCapability;
}): Promise<SendSmsResult> {
  const from = requireSecret("RINGCENTRAL_FROM_NUMBER");

  if (args.capability === "A2PSmsSender") {
    const json = await rcJson<{
      id?: string;
      creationTime?: string;
      messages?: { id?: string }[];
    }>("/restapi/v1.0/account/~/a2p-sms/batches", {
      method: "POST",
      body: JSON.stringify({
        from,
        messages: [{ to: [args.to], text: args.text }],
      }),
    });
    return {
      providerMessageId: json.messages?.[0]?.id ?? json.id ?? null,
      providerCreatedAt: json.creationTime ?? null,
      deliveryState: "queued",
      raw: sanitize(json),
    };
  }

  const json = await rcJson<{
    id?: number | string;
    creationTime?: string;
    messageStatus?: string;
  }>("/restapi/v1.0/account/~/extension/~/sms", {
    method: "POST",
    body: JSON.stringify({
      from: { phoneNumber: from },
      to: [{ phoneNumber: args.to }],
      text: args.text,
    }),
  });

  return {
    providerMessageId: json.id != null ? String(json.id) : null,
    providerCreatedAt: json.creationTime ?? null,
    deliveryState: json.messageStatus === "Sent" ? "sent" : "queued",
    raw: sanitize(json),
  };
}

export type RcSubscription = {
  id: string;
  status: string;
  expirationTime?: string;
  eventFilters?: string[];
  deliveryMode?: { address?: string; transportType?: string };
};

export async function createWebhookSubscription(address: string): Promise<RcSubscription> {
  const verificationToken = requireSecret("RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN");
  return rcJson<RcSubscription>("/restapi/v1.0/subscription", {
    method: "POST",
    body: JSON.stringify({
      eventFilters: EVENT_FILTERS,
      expiresIn: 604800,
      deliveryMode: {
        transportType: "WebHook",
        address,
        verificationToken,
      },
    }),
  });
}

export const EVENT_FILTERS = [
  "/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS",
  "/restapi/v1.0/account/~/extension/~/message-store",
];

export async function renewSubscription(id: string): Promise<RcSubscription> {
  return rcJson<RcSubscription>(`/restapi/v1.0/subscription/${id}/renew`, { method: "POST" });
}

export async function getSubscription(id: string): Promise<RcSubscription> {
  return rcJson<RcSubscription>(`/restapi/v1.0/subscription/${id}`);
}

export type RcStoreMessage = {
  id?: number | string;
  direction?: string;
  type?: string;
  subject?: string;
  messageStatus?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  from?: { phoneNumber?: string };
  to?: { phoneNumber?: string }[];
  attachments?: { id?: number | string; contentType?: string; uri?: string }[];
};

export async function readCallLogPage(query: CallLogPageQuery): Promise<{
  records: RawCallRecord[];
  hasNext: boolean;
}> {
  const path = callLogRequestPath(query);
  const json = await rcJson<{
    records?: RawCallRecord[];
    navigation?: { nextPage?: { uri?: string } };
  }>(path, { method: "GET" });
  const records = Array.isArray(json.records) ? json.records : [];
  const navigation = json.navigation;
  const hasNext = navigation ? Boolean(navigation.nextPage?.uri) : records.length >= query.perPage;
  return { records, hasNext };
}

export async function listRecentMessages(sinceIso: string): Promise<RcStoreMessage[]> {
  const params = new URLSearchParams({
    dateFrom: sinceIso,
    messageType: "SMS",
    perPage: "100",
  });
  const json = await rcJson<{ records?: RcStoreMessage[] }>(
    `/restapi/v1.0/account/~/extension/~/message-store?${params.toString()}`,
  );
  return json.records ?? [];
}

/** Keep only non-sensitive provider metadata for storage. */
export function sanitize(raw: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "id",
    "creationTime",
    "lastModifiedTime",
    "messageStatus",
    "readStatus",
    "type",
    "direction",
    "batchId",
  ];
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in raw) out[key] = raw[key];
  return out;
}
