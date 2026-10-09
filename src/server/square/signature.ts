import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Square signs `notificationUrl + rawBody` with HMAC-SHA256 and base64.
 * The URL must be the exact notification URL registered on the subscription.
 * https://developer.squareup.com/docs/webhooks/step3validate
 */
export function squareSignature(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
): string {
  return createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody, "utf8")
    .digest("base64");
}

export function verifySquareSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  signatureKey: string | null;
  notificationUrl: string | null;
}): boolean {
  if (!args.signatureHeader || !args.signatureKey || !args.notificationUrl) return false;
  const expected = squareSignature(args.signatureKey, args.notificationUrl, args.rawBody);
  const presented = args.signatureHeader.trim();
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
