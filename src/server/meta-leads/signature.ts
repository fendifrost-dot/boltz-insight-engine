// Meta webhook authenticity helpers. Pure (Web Crypto only) so they run on the
// Cloudflare worker target and under node:test alike.

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function sha256Hex(payload: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(payload)));
}

/**
 * Verifies `X-Hub-Signature-256: sha256=<hex>` against the exact raw request
 * body. The body must not be re-serialized before this check.
 */
export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return constantTimeEqual(match[1]!.toLowerCase(), expected);
}

/**
 * Subscription handshake: Meta sends GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 * Returns the challenge to echo, or null when the request must be rejected.
 */
export function verifyHandshake(
  params: URLSearchParams,
  expectedToken: string | undefined,
): string | null {
  if (!expectedToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (!challenge || !constantTimeEqual(token, expectedToken)) return null;
  return challenge;
}
