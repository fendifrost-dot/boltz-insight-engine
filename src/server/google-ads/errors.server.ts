export type AdsErrorClass =
  | "ok"
  | "oauth_refresh_failed"
  | "service_disabled"
  | "user_permission_denied"
  | "developer_token_not_approved"
  | "developer_token_invalid"
  | "developer_token_prohibited"
  | "customer_not_enabled"
  | "sunset_404"
  | "unknown";

export type ParsedAdsError = {
  status: number;
  errorClass: AdsErrorClass;
  googleCode: string | null;
  message: string;
};

/** Strip anything that looks like a token out of provider error text. */
export function redact(text: string): string {
  return text
    .replace(/(ya29|1\/\/)[A-Za-z0-9._\-]+/g, "[redacted-token]")
    .slice(0, 800);
}

/** Parse a Google Ads / OAuth error body without keeping tokens. */
export function parseAdsError(status: number, body: string): ParsedAdsError {
  const redacted = redact(body);
  const lower = body.toLowerCase();
  let googleCode: string | null = null;
  try {
    const json = JSON.parse(body) as {
      error?: { status?: string; message?: string; details?: unknown[] };
      errors?: { errorCode?: Record<string, string>; message?: string }[];
    };
    const details = json.error?.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        const errors = (detail as { errors?: { errorCode?: Record<string, string> }[] }).errors;
        if (!errors) continue;
        for (const err of errors) {
          const code = err.errorCode;
          if (!code) continue;
          googleCode = Object.values(code)[0] ?? null;
        }
      }
    }
    if (!googleCode && json.errors?.[0]?.errorCode) {
      googleCode = Object.values(json.errors[0].errorCode)[0] ?? null;
    }
  } catch {
    // HTML sunset 404s are not JSON.
  }

  const code = (googleCode ?? "").toUpperCase();
  let errorClass: AdsErrorClass = "unknown";
  if (status === 404 && (lower.includes("<html") || lower.includes("error 404"))) {
    errorClass = "sunset_404";
  } else if (code === "USER_PERMISSION_DENIED" || lower.includes("user_permission_denied")) {
    errorClass = "user_permission_denied";
  } else if (code === "DEVELOPER_TOKEN_NOT_APPROVED" || lower.includes("developer_token_not_approved")) {
    errorClass = "developer_token_not_approved";
  } else if (code === "DEVELOPER_TOKEN_INVALID" || lower.includes("developer_token_invalid")) {
    errorClass = "developer_token_invalid";
  } else if (code === "DEVELOPER_TOKEN_PROHIBITED" || lower.includes("developer_token_prohibited")) {
    errorClass = "developer_token_prohibited";
  } else if (code === "CUSTOMER_NOT_ENABLED" || lower.includes("customer_not_enabled")) {
    errorClass = "customer_not_enabled";
  } else if (
    code === "SERVICE_DISABLED" ||
    lower.includes("service_disabled") ||
    (lower.includes("googleads.googleapis.com") && lower.includes("has not been used"))
  ) {
    errorClass = "service_disabled";
  }

  return { status, errorClass, googleCode, message: `Google Ads query failed (${status}): ${redacted}` };
}

export class AdsRequestError extends Error {
  readonly parsed: ParsedAdsError;
  constructor(parsed: ParsedAdsError) {
    super(parsed.message);
    this.name = "AdsRequestError";
    this.parsed = parsed;
  }
}
