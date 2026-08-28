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
