// Server-only secret access for Meta Lead Ads. Never import from client code.

export type MetaSecretName =
  | "META_APP_ID"
  | "META_APP_SECRET"
  | "META_PAGE_ID"
  | "META_PAGE_ACCESS_TOKEN"
  | "META_WEBHOOK_VERIFY_TOKEN"
  | "META_GRAPH_API_VERSION"
  | "META_AUTO_FIRST_TOUCH";

export const META_SECRET_NAMES: MetaSecretName[] = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_PAGE_ID",
  "META_PAGE_ACCESS_TOKEN",
  "META_WEBHOOK_VERIFY_TOKEN",
  "META_GRAPH_API_VERSION",
  "META_AUTO_FIRST_TOUCH",
];

/** Version pin and the first-touch switch have safe defaults. */
export const META_OPTIONAL_SECRETS: MetaSecretName[] = [
  "META_GRAPH_API_VERSION",
  "META_AUTO_FIRST_TOUCH",
];

/** Bump when Meta sunsets it; each Graph version lives roughly two years. */
export const DEFAULT_GRAPH_API_VERSION = "v24.0";

export function readMetaSecret(name: MetaSecretName): string | undefined {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  return undefined;
}

export function requireMetaSecret(name: MetaSecretName): string {
  const value = readMetaSecret(name);
  if (!value) throw new Error(`Missing server secret: ${name}. Enter it in Lovable Cloud secrets.`);
  return value;
}

export function graphApiVersion(): string {
  const configured = readMetaSecret("META_GRAPH_API_VERSION");
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_API_VERSION;
}

/**
 * Automated first-touch SMS to a Meta lead is off unless explicitly enabled.
 * Even when on, it only fires for leads whose form captured SMS consent.
 */
export function autoFirstTouchEnabled(): boolean {
  return readMetaSecret("META_AUTO_FIRST_TOUCH")?.toLowerCase() === "enabled";
}

/** Never returns secret values — presence only, plus non-sensitive identifiers. */
export function metaSecretStatus(): {
  name: MetaSecretName;
  configured: boolean;
  optional: boolean;
  masked: string | null;
}[] {
  return META_SECRET_NAMES.map((name) => {
    const value = readMetaSecret(name);
    return {
      name,
      configured: Boolean(value),
      optional: META_OPTIONAL_SECRETS.includes(name),
      masked: value ? maskMeta(name, value) : null,
    };
  });
}

function maskMeta(name: MetaSecretName, value: string): string | null {
  if (name === "META_APP_ID" || name === "META_PAGE_ID") return value;
  if (name === "META_GRAPH_API_VERSION" || name === "META_AUTO_FIRST_TOUCH") return value;
  return `configured (${value.length} chars)`;
}

export function metaConfigError(): string | null {
  const missing = META_SECRET_NAMES.filter(
    (n) => !META_OPTIONAL_SECRETS.includes(n) && !readMetaSecret(n),
  );
  if (missing.length === 0) return null;
  return `Meta Lead Ads is not configured. Missing: ${missing.join(", ")}.`;
}
