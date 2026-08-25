/**
 * Typed RingCentral adapter — JWT server-to-server OAuth.
 * Token cache with single-flight refresh, one retry after 401, Retry-After for 429.
 * Never persists client secret or JWT to the database.
 */

import { getRingCentralConfig } from "@/lib/server/env.server";
import { normalizeToE164, phonesEqual } from "@/lib/server/phone.server";
import type {
  MessageStoreRecord,
  RingCentralExtensionInfo,
  RingCentralPhoneNumber,
  RingCentralToken,
  SendSmsInput,
  SendSmsResult,
  SmsCapability,
  SubscriptionRecord,
} from "./types";
import { RingCentralSetupError } from "./types";

type TokenState = {
  token: RingCentralToken | null;
  inflight: Promise<RingCentralToken> | null;
};

const tokenState: TokenState = {
  token: null,
  inflight: null,
};

const EXPIRY_SKEW_MS = 60_000;

function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

async function fetchAccessToken(force = false): Promise<RingCentralToken> {
  const now = Date.now();
  if (!force && tokenState.token && tokenState.token.expiresAtMs - EXPIRY_SKEW_MS > now) {
    return tokenState.token;
  }

  if (tokenState.inflight) {
    return tokenState.inflight;
  }

  tokenState.inflight = (async () => {
    const config = getRingCentralConfig();
    const url = `${config.serverUrl}/restapi/oauth/token`;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: config.jwt,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(config.clientId, config.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      tokenState.token = null;
      throw new RingCentralSetupError(
        "oauth_failed",
        `RingCentral JWT OAuth failed with status ${response.status}`,
      );
    }

    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
      owner_id?: string;
      scope?: string;
    };

    if (!json.access_token || !json.expires_in) {
      throw new RingCentralSetupError("oauth_invalid", "RingCentral OAuth response missing token");
    }

    const token: RingCentralToken = {
      accessToken: json.access_token,
      expiresAtMs: Date.now() + json.expires_in * 1000,
      tokenType: json.token_type ?? "bearer",
      ownerId: json.owner_id ?? null,
      scope: json.scope ?? null,
    };
    tokenState.token = token;
    return token;
  })();

  try {
    return await tokenState.inflight;
  } finally {
    tokenState.inflight = null;
  }
}

/** Test-only helper to reset cached token state. */
export function __resetRingCentralTokenCacheForTests(): void {
  tokenState.token = null;
  tokenState.inflight = null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest<T>(
  method: string,
  path: string,
  init?: { body?: unknown; query?: Record<string, string>; retried401?: boolean },
): Promise<T> {
  const config = getRingCentralConfig();
  const token = await fetchAccessToken(Boolean(init?.retried401));
  const url = new URL(path.startsWith("http") ? path : `${config.serverUrl}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `${token.tokenType} ${token.accessToken}`,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const response = await fetch(
    url.toString(),
    body === undefined
      ? { method, headers: new Headers(headers) }
      : { method, headers: new Headers(headers), body },
  );

  if (response.status === 401 && !init?.retried401) {
    tokenState.token = null;
    return apiRequest<T>(method, path, { ...init, retried401: true });
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
    const waitMs = Number.isFinite(retryAfter) ? Math.max(1, retryAfter) * 1000 : 1000;
    await sleep(waitMs);
    return apiRequest<T>(method, path, init);
  }

  if (!response.ok) {
    throw new RingCentralSetupError(
      "api_error",
      `RingCentral ${method} ${path} failed with status ${response.status}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getAuthenticatedExtension(): Promise<RingCentralExtensionInfo> {
  const data = await apiRequest<{
    id?: number | string;
    extensionNumber?: string;
    name?: string;
    type?: string;
  }>("GET", "/restapi/v1.0/account/~/extension/~");

  if (data.id == null) {
    throw new RingCentralSetupError("extension_missing", "Authenticated extension not found");
  }

  return {
    id: String(data.id),
    extensionNumber: data.extensionNumber ?? null,
    name: data.name ?? null,
    type: data.type ?? null,
  };
}

export async function listExtensionPhoneNumbers(): Promise<RingCentralPhoneNumber[]> {
  const data = await apiRequest<{
    records?: Array<{
      id?: number | string;
      phoneNumber?: string;
      usageType?: string;
      features?: string[];
    }>;
  }>("GET", "/restapi/v1.0/account/~/extension/~/phone-number");

  return (data.records ?? [])
    .map((r) => ({
      id: r.id != null ? String(r.id) : null,
      phoneNumber: r.phoneNumber ?? "",
      usageType: r.usageType ?? null,
      features: r.features ?? [],
    }))
    .filter((r) => r.phoneNumber.length > 0);
}

export function detectSmsCapability(features: string[]): SmsCapability {
  if (features.includes("SmsSender")) return "SmsSender";
  if (features.includes("A2PSmsSender")) return "A2PSmsSender";
  return "none";
}

export async function resolveFromNumberCapability(
  fromNumber?: string,
): Promise<{ phone: RingCentralPhoneNumber; capability: SmsCapability }> {
  const config = getRingCentralConfig();
  const target = normalizeToE164(fromNumber ?? config.fromNumber);
  if (!target) {
    throw new RingCentralSetupError("from_invalid", "RINGCENTRAL_FROM_NUMBER is not valid E.164");
  }

  const numbers = await listExtensionPhoneNumbers();
  const match = numbers.find((n) => phonesEqual(n.phoneNumber, target));
  if (!match) {
    throw new RingCentralSetupError(
      "from_not_assigned",
      `Configured from-number is not assigned or authorized on the authenticated extension`,
    );
  }

  const capability = detectSmsCapability(match.features);
  if (capability === "none") {
    throw new RingCentralSetupError(
      "sms_not_enabled",
      "Configured from-number is not SMS-enabled (missing SmsSender and A2PSmsSender)",
    );
  }

  return { phone: match, capability };
}

function redactSendResponse(json: Record<string, unknown>): Record<string, unknown> {
  const { id, messageStatus, creationTime, type, direction } = json as {
    id?: unknown;
    messageStatus?: unknown;
    creationTime?: unknown;
    type?: unknown;
    direction?: unknown;
  };
  return {
    id: id ?? null,
    messageStatus: messageStatus ?? null,
    creationTime: creationTime ?? null,
    type: type ?? null,
    direction: direction ?? null,
  };
}

/**
 * Send SMS using the capability-matched RingCentral endpoint.
 * SmsSender → /extension/~/sms
 * A2PSmsSender-only → /a2p-sms/batches (single-message batch)
 * Never silently call the standard endpoint for an A2P-only number.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const from = normalizeToE164(input.from);
  const to = normalizeToE164(input.to);
  if (!from || !to) {
    throw new RingCentralSetupError("phone_invalid", "SMS from/to must be valid E.164 numbers");
  }
  if (!input.text.trim()) {
    throw new RingCentralSetupError("empty_body", "SMS body must not be empty");
  }

  const { capability } = await resolveFromNumberCapability(from);

  if (capability === "SmsSender") {
    const json = await apiRequest<Record<string, unknown>>(
      "POST",
      "/restapi/v1.0/account/~/extension/~/sms",
      {
        body: {
          from: { phoneNumber: from },
          to: [{ phoneNumber: to }],
          text: input.text,
        },
      },
    );
    const id = json["id"] != null ? String(json["id"]) : "";
    if (!id) {
      throw new RingCentralSetupError(
        "send_missing_id",
        "RingCentral SMS response missing message id",
      );
    }
    return {
      providerMessageId: id,
      deliveryState: "sent",
      rawRedacted: redactSendResponse(json),
    };
  }

  // A2PSmsSender only — use high-volume batch API for a single transactional message.
  const json = await apiRequest<Record<string, unknown>>(
    "POST",
    "/restapi/v1.0/account/~/a2p-sms/batches",
    {
      body: {
        from: from,
        messages: [{ to: [to], text: input.text }],
      },
    },
  );

  const id =
    json["id"] != null
      ? String(json["id"])
      : json["batchId"] != null
        ? String(json["batchId"])
        : "";
  if (!id) {
    throw new RingCentralSetupError(
      "a2p_send_missing_id",
      "RingCentral A2P SMS response missing batch id",
    );
  }

  return {
    providerMessageId: id,
    deliveryState: "queued",
    rawRedacted: redactSendResponse(json),
  };
}

export async function getMessageStoreRecord(messageId: string): Promise<MessageStoreRecord> {
  return apiRequest<MessageStoreRecord>(
    "GET",
    `/restapi/v1.0/account/~/extension/~/message-store/${encodeURIComponent(messageId)}`,
  );
}

export async function listMessageStore(params: {
  dateFrom: string;
  dateTo?: string;
  messageType?: string;
  perPage?: number;
}): Promise<MessageStoreRecord[]> {
  const query: Record<string, string> = {
    dateFrom: params.dateFrom,
    perPage: String(params.perPage ?? 100),
  };
  if (params.dateTo) query["dateTo"] = params.dateTo;
  if (params.messageType) query["messageType"] = params.messageType;

  const data = await apiRequest<{ records?: MessageStoreRecord[] }>(
    "GET",
    "/restapi/v1.0/account/~/extension/~/message-store",
    { query },
  );
  return data.records ?? [];
}

export async function createSmsWebhookSubscription(input: {
  deliveryAddress: string;
  verificationToken: string;
  expiresIn?: number;
}): Promise<SubscriptionRecord> {
  const json = await apiRequest<{
    id?: string;
    status?: string;
    expirationTime?: string;
    eventFilters?: string[];
    deliveryMode?: SubscriptionRecord["deliveryMode"];
  }>("POST", "/restapi/v1.0/subscription", {
    body: {
      eventFilters: ["/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS"],
      deliveryMode: {
        transportType: "WebHook",
        address: input.deliveryAddress,
        verificationToken: input.verificationToken,
      },
      expiresIn: input.expiresIn ?? 604800,
    },
  });

  if (!json.id) {
    throw new RingCentralSetupError("subscription_create_failed", "Subscription create missing id");
  }

  return {
    id: json.id,
    status: json.status ?? "Unknown",
    expiresAt: json.expirationTime ?? null,
    eventFilters: json.eventFilters ?? [],
    deliveryMode: json.deliveryMode ?? { transportType: "WebHook", address: input.deliveryAddress },
  };
}

export async function renewSubscription(
  subscriptionId: string,
  expiresIn = 604800,
): Promise<SubscriptionRecord> {
  const json = await apiRequest<{
    id?: string;
    status?: string;
    expirationTime?: string;
    eventFilters?: string[];
    deliveryMode?: SubscriptionRecord["deliveryMode"];
  }>("POST", `/restapi/v1.0/subscription/${encodeURIComponent(subscriptionId)}/renew`, {
    body: { expiresIn },
  });

  return {
    id: json.id ?? subscriptionId,
    status: json.status ?? "Unknown",
    expiresAt: json.expirationTime ?? null,
    eventFilters: json.eventFilters ?? [],
    deliveryMode: json.deliveryMode ?? { transportType: "WebHook" },
  };
}

export async function listSubscriptions(): Promise<SubscriptionRecord[]> {
  const data = await apiRequest<{
    records?: Array<{
      id?: string;
      status?: string;
      expirationTime?: string;
      eventFilters?: string[];
      deliveryMode?: SubscriptionRecord["deliveryMode"];
    }>;
  }>("GET", "/restapi/v1.0/subscription");

  return (data.records ?? [])
    .filter((r) => r.id)
    .map((r) => ({
      id: r.id!,
      status: r.status ?? "Unknown",
      expiresAt: r.expirationTime ?? null,
      eventFilters: r.eventFilters ?? [],
      deliveryMode: r.deliveryMode ?? { transportType: "WebHook" },
    }));
}

export { fetchAccessToken };
