export class SquareApiError extends Error {
  readonly status: number;
  readonly category: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, category: string, code: string) {
    super(`Square API ${status} ${category || "UNKNOWN"} ${code || "HTTP_ERROR"}`);
    this.name = "SquareApiError";
    this.status = status;
    this.category = category || "UNKNOWN";
    this.code = code || "HTTP_ERROR";
    this.retryable = status === 429 || status >= 500;
  }
}

export class SquareNotConfiguredError extends Error {
  readonly code = "square_not_configured";

  constructor(reason: string) {
    super(reason);
    this.name = "SquareNotConfiguredError";
  }
}

/** Drop tokens, emails, and long digit runs from anything that might be logged. */
export function redactSquareText(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/EAAA[\w-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\+?\d{7,}/g, "[redacted]")
    .slice(0, 300);
}

export function squareErrorCode(error: unknown): string {
  if (error instanceof SquareApiError) return error.code.toLowerCase().slice(0, 40);
  if (error instanceof SquareNotConfiguredError) return error.code;
  if (error instanceof Error && /^square_[a-z0-9_]+$/.test(error.message)) {
    return error.message.slice(0, 40);
  }
  return "error";
}
