// Server-only Google Ads API client (REST). Never import from client code.
import {
  adsConfigError,
  normalizeCustomerId,
  readAdsSecret,
  requireAdsSecret,
} from "./env.server";

// Versioned REST base. Sunset versions return a bare HTML 404; as of Aug 2026
// supported versions are v22+. Bump when Google sunsets this one.
const API_VERSION = "v22";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Boltz change-control freeze. No production ads mutations before this instant.
 * 2026-08-29 10:00 America/Chicago (UTC-5) === 2026-08-29T15:00:00Z.
 */
export const ADS_WRITE_FREEZE_UNTIL = Date.parse("2026-08-29T15:00:00Z");

export function adsWriteFreezeActive(now: number = Date.now()): boolean {
  return now < ADS_WRITE_FREEZE_UNTIL;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const body = new URLSearchParams({
    client_id: requireAdsSecret("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requireAdsSecret("GOOGLE_ADS_CLIENT_SECRET"),
    refresh_token: requireAdsSecret("GOOGLE_ADS_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${redact(text)}`);
  }
  const json = JSON.parse(text) as { access_token: string; expires_in?: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

function adsHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": requireAdsSecret("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "Content-Type": "application/json",
  };
  const login = readAdsSecret("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  if (login) headers["login-customer-id"] = normalizeCustomerId(login);
  return headers;
}

export function adsCustomerId(): string {
  return normalizeCustomerId(requireAdsSecret("GOOGLE_ADS_CUSTOMER_ID"));
}

/** Strip anything that looks like a token out of provider error text. */
function redact(text: string): string {
  return text
    .replace(/(ya29|1\/\/)[A-Za-z0-9._\-]+/g, "[redacted-token]")
    .slice(0, 800);
}

/** Run a GAQL query via searchStream and return flattened result rows. */
export async function adsSearch<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const configError = adsConfigError();
  if (configError) throw new Error(configError);

  const token = await getAccessToken();
  const customerId = adsCustomerId();
  const res = await fetch(`${API_BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: adsHeaders(token),
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Ads query failed (${res.status}): ${redact(text)}`);

  const payload = JSON.parse(text) as unknown;
  const chunks = Array.isArray(payload) ? payload : [payload];
  const rows: T[] = [];
  for (const chunk of chunks) {
    const results = (chunk as { results?: T[] }).results;
    if (results) rows.push(...results);
  }
  return rows;
}

/**
 * Mutation entry point. Every write goes through here so the freeze and the
 * explicit-confirmation rule cannot be bypassed by a caller.
 */
export async function adsMutate(
  resource: "campaigns" | "adGroupCriteria" | "campaignBudgets",
  operations: unknown[],
  opts: { confirmed: boolean; validateOnly?: boolean },
): Promise<{ ok: boolean; reason?: string; result?: unknown }> {
  if (!opts.confirmed) {
    return { ok: false, reason: "Write not confirmed by an owner — refused." };
  }
  if (adsWriteFreezeActive() && !opts.validateOnly) {
    return {
      ok: false,
      reason:
        "Change-control freeze active until 2026-08-29 10:00 America/Chicago. Live ads writes are blocked; run with validateOnly to dry-run.",
    };
  }

  const token = await getAccessToken();
  const customerId = adsCustomerId();
  const res = await fetch(`${API_BASE}/customers/${customerId}/${resource}:mutate`, {
    method: "POST",
    headers: adsHeaders(token),
    body: JSON.stringify({
      operations,
      validateOnly: opts.validateOnly ?? false,
      partialFailure: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, reason: `Google Ads mutate failed (${res.status}): ${redact(text)}` };
  }
  return { ok: true, result: JSON.parse(text) as unknown };
}

export function micros(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}
