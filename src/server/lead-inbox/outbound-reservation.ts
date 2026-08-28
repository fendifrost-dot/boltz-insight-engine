export type OutboundReservationAction = "send" | "skip" | "review";

export type OutboundReservationResult = {
  action: OutboundReservationAction;
  status: string;
  reservationId?: string;
  claimGeneration?: number;
  messageId?: string | null;
  providerMessageId?: string | null;
  reason?: string;
};

export function parseOutboundReservationResult(data: unknown): OutboundReservationResult {
  const payload = (data ?? {}) as Record<string, unknown>;
  const action = payload.action;
  if (action !== "send" && action !== "skip" && action !== "review") {
    throw new Error(`Unexpected outbound reservation action: ${String(action)}`);
  }
  return {
    action,
    status: String(payload.status ?? "unknown"),
    reservationId: typeof payload.reservation_id === "string" ? payload.reservation_id : undefined,
    claimGeneration:
      typeof payload.claim_generation === "number"
        ? payload.claim_generation
        : typeof payload.claim_generation === "string"
          ? Number(payload.claim_generation)
          : undefined,
    messageId: typeof payload.message_id === "string" ? payload.message_id : null,
    providerMessageId:
      typeof payload.provider_message_id === "string" ? payload.provider_message_id : null,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
  };
}

export class OutboundReservationLostError extends Error {
  constructor() {
    super("Outbound send reservation lost before completion");
  }
}

export function assertOutboundCompletionStatus(
  data: unknown,
  expected: "sent" | "failed" | "ambiguous" | "lost_reservation",
): string {
  const payload = (data ?? {}) as Record<string, unknown>;
  const status = String(payload.status ?? "");
  if (status !== expected) {
    throw new Error(`Unexpected outbound completion status: ${status}`);
  }
  return status;
}
