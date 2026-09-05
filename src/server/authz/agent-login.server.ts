import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import {
  evaluateLoginRateLimit,
  formatRetryAfter,
  recordLoginFailure,
  recordLoginSuccess,
  type LoginAttemptRecord,
} from "@/lib/login-rate-limit";
import {
  pickSessionTokens,
  publicSignInErrorMessage,
  type BrowserSessionTokens,
} from "@/lib/agent-auth";

export const AGENT_AUTH_EMAIL_SECRET = "AGENT_AUTH_EMAIL";
export const AGENT_AUTH_PASSWORD_SECRET = "AGENT_AUTH_PASSWORD";

const attempts = new Map<string, LoginAttemptRecord>();

function readAgentSecret(name: string): string | undefined {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  return undefined;
}

export function agentAuthSecretsConfigured(): boolean {
  return Boolean(
    readAgentSecret(AGENT_AUTH_EMAIL_SECRET) && readAgentSecret(AGENT_AUTH_PASSWORD_SECRET),
  );
}

type AgentAuthCredentials = { email: string; password: string };

let vaultCredentialsCache: AgentAuthCredentials | null | undefined;

async function readVaultAgentSecret(name: "AGENT_AUTH_EMAIL" | "AGENT_AUTH_PASSWORD"): Promise<string | undefined> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("read_agent_auth_secret", {
      secret_name: name,
    });
    if (error || typeof data !== "string") return undefined;
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Env secrets win. Vault is the production bootstrap so auto-login works before Lovable env is filled. */
export async function resolveAgentAuthCredentials(): Promise<AgentAuthCredentials | null> {
  const envEmail = readAgentSecret(AGENT_AUTH_EMAIL_SECRET);
  const envPassword = readAgentSecret(AGENT_AUTH_PASSWORD_SECRET);
  if (envEmail && envPassword) return { email: envEmail, password: envPassword };

  if (vaultCredentialsCache !== undefined) return vaultCredentialsCache;

  const [email, password] = await Promise.all([
    readVaultAgentSecret("AGENT_AUTH_EMAIL"),
    readVaultAgentSecret("AGENT_AUTH_PASSWORD"),
  ]);
  vaultCredentialsCache = email && password ? { email, password } : null;
  return vaultCredentialsCache;
}

function clientIp(): string {
  try {
    const request = getRequest();
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return request.headers.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function takeRateLimit(key: string, nowMs: number): { allowed: boolean; retryAfterMs: number } {
  const decision = evaluateLoginRateLimit(attempts.get(key), nowMs);
  attempts.set(key, decision.record);
  return { allowed: decision.allowed, retryAfterMs: decision.retryAfterMs };
}

function noteFailure(key: string, nowMs: number): void {
  const current = attempts.get(key) ?? { failures: 0, windowStartMs: nowMs, lockedUntilMs: 0 };
  attempts.set(key, recordLoginFailure(current, nowMs));
}

function noteSuccess(key: string): void {
  attempts.set(key, recordLoginSuccess());
}

function createAnonAuthClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new Error("Supabase is not configured");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export type StoredAgentSignInResult =
  { ok: true; session: BrowserSessionTokens } | { ok: false; reason: string };

export async function signInWithStoredAgentCredentials(): Promise<StoredAgentSignInResult> {
  const nowMs = Date.now();
  const ip = clientIp();
  const limit = takeRateLimit(`stored:${ip}`, nowMs);
  if (!limit.allowed) {
    return {
      ok: false,
      reason: `Too many sign-in attempts. Try again in ${formatRetryAfter(limit.retryAfterMs)}.`,
    };
  }

  const credentials = await resolveAgentAuthCredentials();
  if (!credentials) {
    return {
      ok: false,
      reason:
        "Shop agent login is not configured yet. Set AGENT_AUTH_EMAIL and AGENT_AUTH_PASSWORD in Lovable secrets.",
    };
  }
  const { email, password } = credentials;

  try {
    const client = createAnonAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    const tokens = pickSessionTokens(data.session);
    if (error || !tokens || !data.user) {
      noteFailure(`stored:${ip}`, nowMs);
      return { ok: false, reason: publicSignInErrorMessage(error?.message) };
    }

    const { data: staff, error: staffError } = await client.rpc("is_staff", {
      _user_id: data.user.id,
    });
    if (staffError || staff !== true) {
      noteFailure(`stored:${ip}`, nowMs);
      await client.auth.signOut({ scope: "local" });
      return { ok: false, reason: "This account is not authorized for shop agent access." };
    }

    noteSuccess(`stored:${ip}`);
    const { writeHttpOnlyRememberCookie } = await import("./remember-cookie.server");
    writeHttpOnlyRememberCookie(tokens.refresh_token);
    return { ok: true, session: tokens };
  } catch {
    noteFailure(`stored:${ip}`, nowMs);
    return { ok: false, reason: publicSignInErrorMessage(undefined) };
  }
}
