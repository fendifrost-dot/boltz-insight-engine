// Server-only stored shop-agent login. Credentials are read from process.env
// when set, otherwise from the Vault via public.read_agent_auth_secret
// (service_role only). Values are cached in memory and are never returned,
// logged, or echoed to the browser.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type StoredAgentResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: number | null }
  | { ok: false; error: string };

type StoredAgentCredentials = { email: string; password: string };

// In-memory cache of resolved credentials (env or Vault). Values never leave
// the server process.
let cachedCredentials: StoredAgentCredentials | null = null;
let resolving: Promise<StoredAgentCredentials | null> | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

async function readVaultSecret(name: string): Promise<string | undefined> {
  const url = readEnv("SUPABASE_URL");
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return undefined;
  const admin = createClient<Database>(url, serviceKey, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("read_agent_auth_secret", { secret_name: name });
  if (error || typeof data !== "string" || data.trim().length === 0) return undefined;
  return data.trim();
}

/** Env first; otherwise the Vault for AGENT_AUTH_EMAIL and AGENT_AUTH_PASSWORD only. */
async function resolveCredentials(): Promise<StoredAgentCredentials | null> {
  if (cachedCredentials) return cachedCredentials;
  if (resolving) return resolving;

  resolving = (async () => {
    const envEmail = readEnv("AGENT_AUTH_EMAIL");
    const envPassword = readEnv("AGENT_AUTH_PASSWORD");
    if (envEmail && envPassword) {
      cachedCredentials = { email: envEmail, password: envPassword };
      return cachedCredentials;
    }
    const vaultEmail = await readVaultSecret("AGENT_AUTH_EMAIL");
    const vaultPassword = await readVaultSecret("AGENT_AUTH_PASSWORD");
    if (vaultEmail && vaultPassword) {
      cachedCredentials = { email: vaultEmail, password: vaultPassword };
      return cachedCredentials;
    }
    return null;
  })();

  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

export async function storedAgentConfigured(): Promise<boolean> {
  return (await resolveCredentials()) !== null;
}

export async function storedAgentSignInServer(): Promise<StoredAgentResult> {
  const credentials = await resolveCredentials();
  if (!credentials) {
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

  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
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
