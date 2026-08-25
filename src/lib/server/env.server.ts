/**
 * Server-only environment accessors.
 * Never import this module from client code — keep the `.server.ts` suffix.
 * Never log returned secret values.
 */

function readOptional(name: string): string | null {
  const value = process.env[name];
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRequired(name: string): string {
  const value = readOptional(name);
  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

export type RingCentralConfig = {
  clientId: string;
  clientSecret: string;
  jwt: string;
  serverUrl: string;
  fromNumber: string;
  webhookValidationToken: string;
};

export type XaiConfig = {
  apiKey: string;
  model: string;
};

export function getRingCentralConfig(): RingCentralConfig {
  return {
    clientId: readRequired("RINGCENTRAL_CLIENT_ID"),
    clientSecret: readRequired("RINGCENTRAL_CLIENT_SECRET"),
    jwt: readRequired("RINGCENTRAL_JWT"),
    serverUrl: (readOptional("RINGCENTRAL_SERVER_URL") ?? "https://platform.ringcentral.com").replace(
      /\/$/,
      "",
    ),
    fromNumber: readRequired("RINGCENTRAL_FROM_NUMBER"),
    webhookValidationToken: readRequired("RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN"),
  };
}

export function getRingCentralConfigStatus(): {
  configured: boolean;
  missing: string[];
  fromNumberMasked: string | null;
  serverUrl: string | null;
} {
  const names = [
    "RINGCENTRAL_CLIENT_ID",
    "RINGCENTRAL_CLIENT_SECRET",
    "RINGCENTRAL_JWT",
    "RINGCENTRAL_FROM_NUMBER",
    "RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN",
  ] as const;
  const missing = names.filter((n) => !readOptional(n));
  const from = readOptional("RINGCENTRAL_FROM_NUMBER");
  return {
    configured: missing.length === 0,
    missing: [...missing],
    fromNumberMasked: from ? maskPhone(from) : null,
    serverUrl: readOptional("RINGCENTRAL_SERVER_URL") ?? "https://platform.ringcentral.com",
  };
}

export function getXaiConfig(): XaiConfig {
  return {
    apiKey: readRequired("XAI_API_KEY"),
    model: readOptional("XAI_MODEL") ?? "grok-4-1-fast-non-reasoning",
  };
}

export function getXaiConfigStatus(): {
  configured: boolean;
  missing: string[];
  model: string | null;
} {
  const missing = ["XAI_API_KEY"].filter((n) => !readOptional(n));
  return {
    configured: missing.length === 0,
    missing,
    model: readOptional("XAI_MODEL") ?? (missing.length === 0 ? "grok-4-1-fast-non-reasoning" : null),
  };
}

export function getCronSecret(): string {
  return readRequired("CRON_SECRET");
}

export function getPublicAppUrl(): string | null {
  return readOptional("PUBLIC_APP_URL");
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return "***";
  return `${e164.slice(0, 2)}******${e164.slice(-4)}`;
}

export function maskSecretConfigured(value: string | null | undefined): "Configured" | "Missing" {
  return value && value.trim().length > 0 ? "Configured" : "Missing";
}
