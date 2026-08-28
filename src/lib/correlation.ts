import { createHash } from "node:crypto";

/** Deterministic correlation identity for a provider inbound message. */
export function deriveInboundCorrelationId(
  providerMessageId: string,
  provider = "ringcentral",
): string {
  const hex = createHash("md5").update(`${provider}:inbound:${providerMessageId}`).digest("hex");
  const variant = ["8", "9", "a", "b"][parseInt(hex.slice(16, 18), 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
