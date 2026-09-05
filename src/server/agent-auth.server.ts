// Server-only stored shop-agent login. Credentials are read from process.env,
// falling back to the Supabase Vault via read_agent_auth_secret (service_role
// only). Values are never returned, logged, or echoed to the browser.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type StoredAgentResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: number | null }
  | { ok: false; error: string };

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

// In-memory cache for vault lookups (per serverless worker instance).
const vaultCache = new Map<string, string | null>();

async function readVaultSecret(name: "AGENT_AUTH_EMAIL" | "AGENT_AUTH_PASSWORD"): Promise<string | undefined> {
  if (vaultCache.has(name)) {
    return vaultCache.get(name) ?? undefined;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("read_agent_auth_secret", { secret_name: name });
    if (error || typeof data !== "string" || data.trim().length === 0) {
      vaultCache.set(name, null);
      return undefined;
    }
    vaultCache.set(name, data.trim());
    return data.trim();
  } catch {
    vaultCache.set(name, null);
    return undefined;
  }
}

async function resolveCredential(name: "AGENT_AUTH_EMAIL" | "AGENT_AUTH_PASSWORD"): Promise<string | undefined> {
  return readEnv(name) ?? (await readVaultSecret(name));
}

/** Presence check for one stored credential (env first, vault fallback). Never returns the value. */
export async function storedAgentSecretConfigured(
  name: "AGENT_AUTH_EMAIL" | "AGENT_AUTH_PASSWORD",
): Promise<boolean> {
  return Boolean(await resolveCredential(name));
}

export async function storedAgentConfigured(): Promise<boolean> {
  const [email, password] = await Promise.all([
    resolveCredential("AGENT_AUTH_EMAIL"),
    resolveCredential("AGENT_AUTH_PASSWORD"),
  ]);
  return Boolean(email && password);
}

export async function storedAgentSignInServer(): Promise<StoredAgentResult> {
  const email = await resolveCredential("AGENT_AUTH_EMAIL");
  const password = await resolveCredential("AGENT_AUTH_PASSWORD");
  if (!email || !password) {
    return { ok: false, error: "Stored shop-agent login is not configured." };
  }

  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return { ok: false, error: "Backend connection is unavailable." };

  const client = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    // Never surface provider text — it can leak credential detail.
    return { ok: false, error: "Sign-in failed. Check the stored shop-agent credentials." };
  }

  const { data: isStaff, error: roleError } = await client.rpc("is_staff", {
    _user_id: data.user.id,
  });
  if (roleError || isStaff !== true) {
    await client.auth.signOut();
    return { ok: false, error: "This account is not authorized for shop-agent access." };
  }

  return {
    ok: true,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? null,
  };
}
