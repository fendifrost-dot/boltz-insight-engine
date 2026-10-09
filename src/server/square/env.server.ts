import { SQUARE_PRODUCTION_BASE, SQUARE_SANDBOX_BASE, SQUARE_WEBHOOK_PATH } from "./version.ts";

export type SquareEnvironmentName = "sandbox" | "production";

export type SquareSecretName =
  | "SQUARE_ACCESS_TOKEN"
  | "SQUARE_APPLICATION_ID"
  | "SQUARE_ENVIRONMENT"
  | "SQUARE_LOCATION_ID"
  | "SQUARE_WEBHOOK_SIGNATURE_KEY";

export const SQUARE_SECRET_NAMES: SquareSecretName[] = [
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_APPLICATION_ID",
  "SQUARE_ENVIRONMENT",
  "SQUARE_LOCATION_ID",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
];

export const SQUARE_OPTIONAL_SECRETS: SquareSecretName[] = [
  "SQUARE_ENVIRONMENT",
  "SQUARE_LOCATION_ID",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
];

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function squareEnvironment():
  { ok: true; value: SquareEnvironmentName } | { ok: false; reason: string } {
  const raw = readEnv("SQUARE_ENVIRONMENT")?.toLowerCase();
  if (!raw) return { ok: true, value: "production" };
  if (raw === "sandbox" || raw === "production") return { ok: true, value: raw };
  return { ok: false, reason: "SQUARE_ENVIRONMENT must be sandbox or production" };
}

export type SquareConfig =
  | { configured: false; reason: string }
  | {
      configured: true;
      accessToken: string;
      applicationId: string | null;
      environment: SquareEnvironmentName;
      locationId: string | null;
      signatureKey: string | null;
      baseUrl: string;
    };

export function readSquareConfig(): SquareConfig {
  const environment = squareEnvironment();
  if (!environment.ok) return { configured: false, reason: environment.reason };
  const accessToken = readEnv("SQUARE_ACCESS_TOKEN");
  if (!accessToken) {
    return {
      configured: false,
      reason: "Square is not configured. Missing: SQUARE_ACCESS_TOKEN.",
    };
  }
  return {
    configured: true,
    accessToken,
    applicationId: readEnv("SQUARE_APPLICATION_ID") ?? null,
    environment: environment.value,
    locationId: readEnv("SQUARE_LOCATION_ID") ?? null,
    signatureKey: readEnv("SQUARE_WEBHOOK_SIGNATURE_KEY") ?? null,
    baseUrl: environment.value === "sandbox" ? SQUARE_SANDBOX_BASE : SQUARE_PRODUCTION_BASE,
  };
}

/** Application id is an identifier, not an auth secret. Never echo it if it equals the token. */
export function displayApplicationId(
  applicationId: string | null,
  accessToken: string | null,
): string | null {
  if (!applicationId) return null;
  if (accessToken && applicationId === accessToken) return null;
  return applicationId;
}

export function squareNotificationUrl(): string | null {
  const base = readEnv("PUBLIC_APP_URL");
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${SQUARE_WEBHOOK_PATH}`;
}

export function squareSecretStatus(): {
  name: SquareSecretName;
  configured: boolean;
  optional: boolean;
  masked: string | null;
}[] {
  const token = readEnv("SQUARE_ACCESS_TOKEN") ?? null;
  return SQUARE_SECRET_NAMES.map((name) => {
    const value = readEnv(name);
    const configured = name === "SQUARE_ENVIRONMENT" ? true : Boolean(value);
    const environment = squareEnvironment();
    let masked: string | null = null;
    if (name === "SQUARE_ENVIRONMENT") {
      masked = environment.ok ? environment.value : "invalid";
    } else if (name === "SQUARE_APPLICATION_ID") {
      masked = displayApplicationId(value ?? null, token);
    } else if (name === "SQUARE_LOCATION_ID" && value) {
      masked = value;
    }
    return {
      name,
      configured,
      optional: SQUARE_OPTIONAL_SECRETS.includes(name),
      masked,
    };
  });
}

export function readBackfillSince(): string | undefined {
  return readEnv("SQUARE_BACKFILL_SINCE");
}

export function webhookSettings(): { signatureKey: string | null; notificationUrl: string | null } {
  return {
    signatureKey: readEnv("SQUARE_WEBHOOK_SIGNATURE_KEY") ?? null,
    notificationUrl: squareNotificationUrl(),
  };
}
