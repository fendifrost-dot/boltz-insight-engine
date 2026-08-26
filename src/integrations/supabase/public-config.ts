// Runtime public Supabase config for the browser.
// Only publishable (anon) values are ever exposed here. Never the service role key.

export type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

declare global {
  interface Window {
    __BOLTZ_SUPABASE__?: Partial<SupabaseBrowserConfig>;
  }
}

function fromProcessEnv(name: string): string {
  try {
    return (typeof process !== "undefined" ? (process.env?.[name] ?? "") : "") || "";
  } catch {
    return "";
  }
}

export function readSupabaseBrowserConfig(): SupabaseBrowserConfig {
  const viteUrl = import.meta.env.VITE_SUPABASE_URL || "";
  const viteKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

  const winUrl = typeof window !== "undefined" ? (window.__BOLTZ_SUPABASE__?.url ?? "") : "";
  const winKey = typeof window !== "undefined" ? (window.__BOLTZ_SUPABASE__?.anonKey ?? "") : "";

  return {
    url: viteUrl || winUrl || fromProcessEnv("SUPABASE_URL"),
    anonKey: viteKey || winKey || fromProcessEnv("SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function getSupabaseConfigError(): string | null {
  const { url, anonKey } = readSupabaseBrowserConfig();
  const missing = [...(!url ? ["VITE_SUPABASE_URL"] : []), ...(!anonKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : [])];
  return missing.length > 0
    ? `Missing Supabase configuration (${missing.join(", ")}). Backend connection is unavailable.`
    : null;
}

let inflight: Promise<SupabaseBrowserConfig> | undefined;

export async function ensureSupabaseBrowserConfig(): Promise<SupabaseBrowserConfig> {
  const current = readSupabaseBrowserConfig();
  if (current.url && current.anonKey) return current;
  if (typeof window === "undefined") return current;

  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch("/api/public/supabase-config", { headers: { accept: "application/json" } });
        if (!res.ok) return readSupabaseBrowserConfig();
        const json = (await res.json()) as Partial<SupabaseBrowserConfig>;
        if (json?.url && json?.anonKey) {
          window.__BOLTZ_SUPABASE__ = { url: json.url, anonKey: json.anonKey };
        }
      } catch {
        // fall through to whatever we already have
      }
      return readSupabaseBrowserConfig();
    })();
  }
  return inflight;
}

// Server-only read, used to inline the publishable config into the HTML shell.
export function serverSupabaseBrowserConfig(): SupabaseBrowserConfig {
  return {
    url: fromProcessEnv("SUPABASE_URL") || import.meta.env.VITE_SUPABASE_URL || "",
    anonKey: fromProcessEnv("SUPABASE_PUBLISHABLE_KEY") || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
  };
}
