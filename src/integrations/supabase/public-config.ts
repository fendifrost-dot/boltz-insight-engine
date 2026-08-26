/** Public (safe) Supabase browser config. Never include the service-role key. */

export type SupabaseBrowserConfig = { url: string; key: string };

declare global {
  interface Window {
    __BOLTZ_SUPABASE__?: SupabaseBrowserConfig;
  }
}

let cached: SupabaseBrowserConfig | null = null;

function fromViteEnv(): SupabaseBrowserConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL || "";
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (url && key) return { url, key };
  return null;
}

function fromWindow(): SupabaseBrowserConfig | null {
  if (typeof window === "undefined") return null;
  const cfg = window.__BOLTZ_SUPABASE__;
  if (cfg?.url && cfg?.key) return { url: cfg.url, key: cfg.key };
  return null;
}

function fromProcessEnv(): SupabaseBrowserConfig | null {
  if (typeof process === "undefined") return null;
  const url = process.env["SUPABASE_URL"] || "";
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || "";
  if (url && key) return { url, key };
  return null;
}

/** Sync read — prefer cache, then Vite, window boot script, then process.env. */
export function readSupabaseBrowserConfig(): SupabaseBrowserConfig {
  if (cached?.url && cached?.key) return cached;
  const hit = fromViteEnv() || fromWindow() || fromProcessEnv();
  if (hit) {
    cached = hit;
    if (typeof window !== "undefined") window.__BOLTZ_SUPABASE__ = hit;
    return hit;
  }
  return { url: "", key: "" };
}

/**
 * Lovable published client builds often strip VITE_SUPABASE_* (and process.env)
 * from the browser bundle. Fetch the publishable URL/key from the server once.
 */
export async function ensureSupabaseBrowserConfig(): Promise<SupabaseBrowserConfig | null> {
  const existing = readSupabaseBrowserConfig();
  if (existing.url && existing.key) return existing;

  if (typeof window === "undefined") return fromProcessEnv();

  try {
    const res = await fetch("/api/public/supabase-config", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; anonKey?: string };
    if (!data.url || !data.anonKey) return null;
    cached = { url: data.url, key: data.anonKey };
    window.__BOLTZ_SUPABASE__ = cached;
    return cached;
  } catch (error) {
    console.error("[Supabase] failed to load public config", error);
    return null;
  }
}

export function getSupabaseConfigError(): string | null {
  const { url, key } = readSupabaseBrowserConfig();
  if (url && key) return null;
  return "Supabase browser config is unavailable. The server may be missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY, or /api/public/supabase-config failed.";
}

/** Server-only helper for HTML boot injection (publishable values only). */
export function serverSupabaseBrowserConfig(): SupabaseBrowserConfig {
  return fromProcessEnv() ?? { url: "", key: "" };
}
