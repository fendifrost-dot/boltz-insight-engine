// Server-only secret access for the Google Ads integration. Never import from client code.

export type AdsSecretName =
  | "GOOGLE_ADS_DEVELOPER_TOKEN"
  | "GOOGLE_ADS_CLIENT_ID"
  | "GOOGLE_ADS_CLIENT_SECRET"
  | "GOOGLE_ADS_REFRESH_TOKEN"
  | "GOOGLE_ADS_CUSTOMER_ID"
  | "GOOGLE_ADS_LOGIN_CUSTOMER_ID";

export const ADS_SECRET_NAMES: AdsSecretName[] = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
];

/** LOGIN_CUSTOMER_ID is only needed when the account sits under a manager account. */
export const ADS_OPTIONAL_SECRETS: AdsSecretName[] = ["GOOGLE_ADS_LOGIN_CUSTOMER_ID"];

export function readAdsSecret(name: AdsSecretName): string | undefined {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  return undefined;
}

export function requireAdsSecret(name: AdsSecretName): string {
  const value = readAdsSecret(name);
  if (!value) {
    throw new Error(`Missing server secret: ${name}. Enter it in Lovable Cloud secrets.`);
  }
  return value;
}

/** Customer IDs are sent to Google without dashes. */
export function normalizeCustomerId(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** Never returns secret values — presence only, plus non-sensitive masked identifiers. */
export function adsSecretStatus(): {
  name: AdsSecretName;
  configured: boolean;
  optional: boolean;
  masked: string | null;
}[] {
  return ADS_SECRET_NAMES.map((name) => {
    const value = readAdsSecret(name);
    return {
      name,
      configured: Boolean(value),
      optional: ADS_OPTIONAL_SECRETS.includes(name),
      masked: value ? maskAds(name, value) : null,
    };
  });
}

function maskAds(name: AdsSecretName, value: string): string | null {
  if (name === "GOOGLE_ADS_CUSTOMER_ID" || name === "GOOGLE_ADS_LOGIN_CUSTOMER_ID") {
    const digits = normalizeCustomerId(value);
    return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "***";
  }
  if (name === "GOOGLE_ADS_CLIENT_ID") {
    const head = value.split("-")[0] ?? "";
    return `${head.slice(0, 6)}…apps.googleusercontent.com`;
  }
  return `configured (${value.length} chars)`;
}

export function adsConfigError(): string | null {
  const missing = ADS_SECRET_NAMES.filter(
    (n) => !ADS_OPTIONAL_SECRETS.includes(n) && !readAdsSecret(n),
  );
  if (missing.length === 0) return null;
  return `Google Ads is not configured. Missing: ${missing.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Live-write gate
// ---------------------------------------------------------------------------

/**
 * Name of the operator flag that enables live Google Ads mutations.
 * Not a secret — a deployment switch — so it is deliberately not in
 * ADS_SECRET_NAMES and never appears in `adsSecretStatus()`.
 */
export const ADS_WRITES_FLAG = "GOOGLE_ADS_WRITES_ENABLED";

export type AdsWriteGate = { allowed: boolean; reason: string };

/**
 * Whether live ads mutations are permitted.
 *
 * This replaces the original time-based change-control freeze
 * (`ADS_WRITE_FREEZE_UNTIL`, 2026-08-29), which expired silently and left
 * `adsMutate` open while the UI still reported protection. A date constant is
 * the wrong shape for this control: it stops protecting on a schedule, without
 * anyone deciding that it should.
 *
 * This gate instead **fails closed and cannot lapse with time**. Live writes
 * stay blocked until an operator explicitly sets the flag in Lovable Cloud
 * secrets, and turning it back off is a single edit. Dry runs (`validateOnly`)
 * are always permitted so changes can still be staged and reviewed.
 */
export function adsWriteGate(env: Record<string, string | undefined> = process.env): AdsWriteGate {
  const raw = env[ADS_WRITES_FLAG];
  // Only an exact, deliberate "true" opens the gate. Anything else — unset,
  // empty, "1", "yes", "TRUE " with junk — stays closed rather than guessing.
  if (raw !== undefined && raw.trim().toLowerCase() === "true") {
    return { allowed: true, reason: `Live ads writes enabled by ${ADS_WRITES_FLAG}.` };
  }
  return {
    allowed: false,
    reason:
      `Live ads writes are disabled. Set ${ADS_WRITES_FLAG}=true in Lovable Cloud ` +
      `secrets to enable them. Dry runs (validateOnly) are always permitted.`,
  };
}
