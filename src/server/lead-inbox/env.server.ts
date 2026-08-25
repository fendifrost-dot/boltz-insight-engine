// Server-only secret access for the lead inbox. Never import from client code.

export type SecretName =
  | "RINGCENTRAL_CLIENT_ID"
  | "RINGCENTRAL_CLIENT_SECRET"
  | "RINGCENTRAL_JWT"
  | "RINGCENTRAL_SERVER_URL"
  | "RINGCENTRAL_FROM_NUMBER"
  | "RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN"
  | "XAI_API_KEY"
  | "XAI_MODEL"
  | "CRON_SECRET"
  | "PUBLIC_APP_URL";

export const SECRET_NAMES: SecretName[] = [
  "RINGCENTRAL_CLIENT_ID",
  "RINGCENTRAL_CLIENT_SECRET",
  "RINGCENTRAL_JWT",
  "RINGCENTRAL_SERVER_URL",
  "RINGCENTRAL_FROM_NUMBER",
  "RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN",
  "XAI_API_KEY",
  "XAI_MODEL",
  "CRON_SECRET",
  "PUBLIC_APP_URL",
];

export function readSecret(name: SecretName): string | undefined {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  // CRON_SECRET may be provisioned under the Lovable-managed name.
  if (name === "CRON_SECRET") {
    const alt = process.env["LOVABLE_CRON_SECRET"];
    if (alt && alt.trim().length > 0) return alt.trim();
  }
  return undefined;
}

export function requireSecret(name: SecretName): string {
  const value = readSecret(name);
  if (!value) throw new Error(`Missing server secret: ${name}. Enter it in Lovable Cloud secrets.`);
  return value;
}

/** Never returns secret values — only presence, plus masked identifiers. */
export function secretStatus(): { name: SecretName; configured: boolean; masked: string | null }[] {
  return SECRET_NAMES.map((name) => {
    const value = readSecret(name);
    return {
      name,
      configured: Boolean(value),
      masked: value ? maskValue(name, value) : null,
    };
  });
}

function maskValue(name: SecretName, value: string): string | null {
  if (name === "RINGCENTRAL_FROM_NUMBER") return maskPhone(value);
  if (name === "RINGCENTRAL_SERVER_URL" || name === "PUBLIC_APP_URL" || name === "XAI_MODEL") {
    return value;
  }
  return null;
}

export function maskPhone(value: string): string {
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.max(0, value.length - 6))}${value.slice(-4)}`;
}

/** Constant-time-ish comparison for bearer/verification tokens. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
