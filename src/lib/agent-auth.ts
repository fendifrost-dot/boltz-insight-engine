/**
 * Client-safe agent auth helpers. Never import server secrets here.
 * Recommended dedicated shop-agent mailbox (create in Supabase Auth; staff role only).
 */
export const RECOMMENDED_AGENT_EMAIL = "agents@boltzautoinc.com";

export type BrowserSessionTokens = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
};

export function publicSignInErrorMessage(raw: string | undefined): string {
  const msg = (raw ?? "").trim().toLowerCase();
  if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
    return "This account is not confirmed yet. Ask the owner to confirm it in Supabase Auth.";
  }
  if (msg.includes("rate") || msg.includes("too many") || msg.includes("over_request")) {
    return "Too many sign-in attempts. Wait a minute and try again.";
  }
  return "Sign-in failed. Check the email and password.";
}

export function pickSessionTokens(
  session:
    | {
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: number | undefined;
        expires_in?: number | undefined;
        token_type?: string | undefined;
      }
    | null
    | undefined,
): BrowserSessionTokens | null {
  if (!session?.access_token || !session.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
  };
}

export function sessionPayloadHasSecrets(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const keys = Object.keys(payload as Record<string, unknown>).map((k) => k.toLowerCase());
  return keys.some((k) => k.includes("password") || k === "agent_auth_password");
}
