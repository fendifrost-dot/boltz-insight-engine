// Bearer check for the Make.com lead intake route. No I/O besides the env var.
import { secretEqual } from "../lead-inbox/env.server.ts";

export const MAKE_LEAD_INTAKE_SECRET_NAME = "MAKE_LEAD_INTAKE_SECRET";

export function readMakeIntakeSecret(): string | undefined {
  const value = process.env[MAKE_LEAD_INTAKE_SECRET_NAME];
  if (value && value.trim().length > 0) return value.trim();
  return undefined;
}

/**
 * 503 when MAKE_LEAD_INTAKE_SECRET is unset, 401 when the bearer does not
 * match, null when it does. Comparison is SHA-256 then timingSafeEqual.
 */
export function authorizeMakeIntake(request: Request): Response | null {
  const secret = readMakeIntakeSecret();
  if (!secret) return new Response("Make intake not configured", { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !secretEqual(token, secret)) return new Response("Unauthorized", { status: 401 });
  return null;
}
