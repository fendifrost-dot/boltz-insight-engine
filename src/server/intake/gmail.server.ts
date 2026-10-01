// Gmail API read of the shop inbox. Server-only. Never logs message bodies.

export type GmailSecretName = "GMAIL_CLIENT_ID" | "GMAIL_CLIENT_SECRET" | "GMAIL_REFRESH_TOKEN";

export const GMAIL_SECRET_NAMES: GmailSecretName[] = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
];

export function readGmailSecret(name: GmailSecretName): string | undefined {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  return undefined;
}

export function gmailConfigError(): string | null {
  const missing = GMAIL_SECRET_NAMES.filter((name) => !readGmailSecret(name));
  if (missing.length === 0) return null;
  return `Gmail lead intake is not configured. Missing: ${missing.join(", ")}.`;
}

export type GmailMessage = {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string | null;
  receivedMs: number | null;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
let cachedToken: { value: string; expiresAt: number } | null = null;

function redact(text: string): string {
  return text.replace(/(ya29|1\/\/)[A-Za-z0-9._\-]+/g, "[redacted-token]").slice(0, 300);
}

async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: readGmailSecret("GMAIL_CLIENT_ID") ?? "",
    client_secret: readGmailSecret("GMAIL_CLIENT_SECRET") ?? "",
    refresh_token: readGmailSecret("GMAIL_REFRESH_TOKEN") ?? "",
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gmail OAuth token refresh failed (${res.status}): ${redact(text)}`);
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Gmail OAuth token refresh returned no access token");
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name?: string; value?: string }[];
};

function decodeBase64Url(data: string): string {
  const pad = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(pad, "base64").toString("utf8");
}

function plainFromPart(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = plainFromPart(child);
    if (found.trim()) return found;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+\n/g, "\n");
  }
  return "";
}

function header(headers: { name?: string; value?: string }[] | undefined, name: string): string {
  const found = headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() ?? "";
}

/** Lists matching messages, newest id pages first, bounded. Bodies stay in memory only. */
export async function listGmailLeadMessages(args: {
  query: string;
  maxPages: number;
}): Promise<{ messages: GmailMessage[]; truncated: boolean }> {
  const token = await accessToken();
  const messages: GmailMessage[] = [];
  let pageToken: string | undefined;
  let truncated = false;
  for (let page = 0; page < args.maxPages; page += 1) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", args.query);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const listRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const listText = await listRes.text();
    if (!listRes.ok) {
      throw new Error(`Gmail list failed (${listRes.status}): ${redact(listText)}`);
    }
    const list = JSON.parse(listText) as {
      messages?: { id?: string }[];
      nextPageToken?: string;
    };
    for (const item of list.messages ?? []) {
      if (!item.id) continue;
      const full = await fetchGmailMessage(token, item.id);
      if (full) messages.push(full);
    }
    if (!list.nextPageToken) return { messages, truncated };
    pageToken = list.nextPageToken;
    if (page === args.maxPages - 1) truncated = true;
  }
  return { messages, truncated };
}

async function fetchGmailMessage(token: string, id: string): Promise<GmailMessage | null> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "full");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gmail get failed (${res.status}): ${redact(text)}`);
  const json = JSON.parse(text) as {
    id?: string;
    internalDate?: string;
    payload?: GmailPart;
  };
  const payload = json.payload;
  const internal = Number(json.internalDate);
  return {
    messageId: json.id ?? id,
    from: header(payload?.headers, "From"),
    subject: header(payload?.headers, "Subject"),
    body: plainFromPart(payload).slice(0, 20_000),
    receivedAt: Number.isFinite(internal) ? new Date(internal).toISOString() : null,
    receivedMs: Number.isFinite(internal) ? internal : null,
  };
}
