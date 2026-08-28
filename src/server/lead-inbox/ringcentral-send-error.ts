export type RingCentralSendFailureKind = "confirmed_rejection" | "ambiguous";

export class RingCentralSendError extends Error {
  kind: RingCentralSendFailureKind;
  status?: number;

  constructor(message: string, kind: RingCentralSendFailureKind, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Classify provider failures that happen before a confirmed acceptance. */
export function classifyRingCentralHttpFailure(status: number): RingCentralSendFailureKind {
  if (status === 429) return "ambiguous";
  if (status >= 500) return "ambiguous";
  if (status >= 400 && status < 500) return "confirmed_rejection";
  return "ambiguous";
}

export function isAmbiguousSendError(error: unknown): boolean {
  if (error instanceof RingCentralSendError) {
    return error.kind === "ambiguous";
  }
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("unparseable provider response")
  );
}
