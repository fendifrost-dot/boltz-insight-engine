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

export type AdsSecretKind =
  | "ads_developer_token"
  | "gemini_api_key"
  | "oauth_client_id"
  | "oauth_client_secret"
  | "oauth_refresh_token"
  | "oauth_access_token"
  | "customer_id"
  | "other";

export type AdsSecretShape = {
  kind: AdsSecretKind;
  expected: string;
  ok: boolean;
  warning: string | null;
};

/** Shape-only classifier. Never returns or logs the secret value. */
export function classifyAdsSecretShape(name: AdsSecretName, value: string): AdsSecretShape {
  const v = value.trim();
  const kind = detectSecretKind(v);
  const expected = expectedKind(name);
  if (kind === expected) {
    return { kind, expected: expectedLabel(expected), ok: true, warning: null };
  }
  return {
    kind,
    expected: expectedLabel(expected),
    ok: false,
    warning: wrongTypeWarning(name, kind),
  };
}

function detectSecretKind(value: string): AdsSecretKind {
  if (value.startsWith("AIza")) return "gemini_api_key";
  if (value.startsWith("ya29")) return "oauth_access_token";
  if (value.startsWith("1//")) return "oauth_refresh_token";
  if (value.startsWith("GOCSPX-")) return "oauth_client_secret";
  if (value.endsWith(".apps.googleusercontent.com")) return "oauth_client_id";
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 10 && /^[0-9-]+$/.test(value)) return "customer_id";
  // Google Ads developer tokens are a 22-char [A-Za-z0-9_-] string (see call-structure docs).
  if (/^[A-Za-z0-9_-]{22}$/.test(value)) return "ads_developer_token";
  return "other";
}

function expectedKind(name: AdsSecretName): AdsSecretKind {
  switch (name) {
    case "GOOGLE_ADS_DEVELOPER_TOKEN":
      return "ads_developer_token";
    case "GOOGLE_ADS_CLIENT_ID":
      return "oauth_client_id";
    case "GOOGLE_ADS_CLIENT_SECRET":
      return "oauth_client_secret";
    case "GOOGLE_ADS_REFRESH_TOKEN":
      return "oauth_refresh_token";
    case "GOOGLE_ADS_CUSTOMER_ID":
    case "GOOGLE_ADS_LOGIN_CUSTOMER_ID":
      return "customer_id";
  }
}

function expectedLabel(kind: AdsSecretKind): string {
  switch (kind) {
    case "ads_developer_token":
      return "22-char Google Ads developer token from API Center";
    case "gemini_api_key":
      return "Gemini / Generative Language API key (AIza…)";
    case "oauth_client_id":
      return "OAuth client ID (….apps.googleusercontent.com)";
    case "oauth_client_secret":
      return "OAuth client secret (GOCSPX-…)";
    case "oauth_refresh_token":
      return "OAuth refresh token (1//…)";
    case "oauth_access_token":
      return "short-lived OAuth access token (ya29…)";
    case "customer_id":
      return "10-digit Google Ads customer ID";
    case "other":
      return "unrecognized";
  }
}

function wrongTypeWarning(name: AdsSecretName, kind: AdsSecretKind): string {
  if (name === "GOOGLE_ADS_DEVELOPER_TOKEN" && kind === "gemini_api_key") {
    return "This looks like a Gemini / AI Studio API key, not an Ads developer token. Paste the 22-character token from Google Ads → API Center.";
  }
  if (name === "GOOGLE_ADS_DEVELOPER_TOKEN" && kind === "oauth_access_token") {
    return "This looks like a short-lived OAuth access token, not a developer token.";
  }
  return `Wrong type for ${name}: observed ${expectedLabel(kind)}, expected ${expectedLabel(expectedKind(name))}.`;
}

/** Never returns secret values — presence only, plus non-sensitive masked identifiers. */
export function adsSecretStatus(): {
  name: AdsSecretName;
  configured: boolean;
  optional: boolean;
  masked: string | null;
  shape: AdsSecretShape | null;
}[] {
  return ADS_SECRET_NAMES.map((name) => {
    const value = readAdsSecret(name);
    return {
      name,
      configured: Boolean(value),
      optional: ADS_OPTIONAL_SECRETS.includes(name),
      masked: value ? maskAds(name, value) : null,
      shape: value ? classifyAdsSecretShape(name, value) : null,
    };
  });
}

export function maskCustomerIdDigits(digits: string): string {
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "***";
}

function maskAds(name: AdsSecretName, value: string): string | null {
  if (name === "GOOGLE_ADS_CUSTOMER_ID" || name === "GOOGLE_ADS_LOGIN_CUSTOMER_ID") {
    return maskCustomerIdDigits(normalizeCustomerId(value));
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
