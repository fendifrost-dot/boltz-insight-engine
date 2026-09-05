import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";
import { readOwnerSessionPersist, setOwnerSessionPersist } from "@/lib/owner-session.storage";
import { storedAgentLoginAvailable, storedAgentSignIn } from "@/lib/agent-auth.functions";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content: "Shop agent and owner sign-in for the Boltz Automotive internal operations system.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Sign in — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Internal access to the Boltz operations system.",
      },
    ],
  }),
  component: AuthPage,
});

const GENERIC_ERROR = "Sign-in failed. Check the email and password.";

function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"agent" | "owner">("agent");
  const [configError, setConfigError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedAvailable, setStoredAvailable] = useState(false);

  const checkStored = useServerFn(storedAgentLoginAvailable);
  const storedSignIn = useServerFn(storedAgentSignIn);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      await ensureSupabaseBrowserConfig();
      const err = getSupabaseConfigError();
      if (cancelled) return;
      setConfigError(err);
      if (err) return;
      setStaySignedIn(readOwnerSessionPersist());

      void checkStored({})
        .then((res) => {
          if (!cancelled) setStoredAvailable(Boolean(res?.available));
        })
        .catch(() => {});

      supabase.auth.getSession().then(({ data }) => {
        if (data.session) navigate({ to: "/", replace: true });
      });
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
          navigate({ to: "/", replace: true });
        }
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [navigate, checkStored]);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (configError) {
      setError(configError);
      return;
    }
    setBusy(true);
    setError(null);
    setOwnerSessionPersist(staySignedIn);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPassword("");
    setBusy(false);
    if (err) setError(GENERIC_ERROR);
    else navigate({ to: "/", replace: true });
  }

  async function useStoredLogin() {
    setBusy(true);
    setError(null);
    setOwnerSessionPersist(staySignedIn);
    try {
      const res = await storedSignIn({});
      if (!res?.ok) {
        setError(res?.error ?? GENERIC_ERROR);
        return;
      }
      const { error: err } = await supabase.auth.setSession({
        access_token: res.accessToken,
        refresh_token: res.refreshToken,
      });
      if (err) setError(GENERIC_ERROR);
      else navigate({ to: "/", replace: true });
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (configError) {
      setError(configError);
      return;
    }
    setBusy(true);
    setError(null);
    setOwnerSessionPersist(staySignedIn);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: ownerEmail.trim(),
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false,
      },
    });
    setBusy(false);
    if (err) setError("Could not send the sign-in link. Check the email address.");
    else setSent(true);
  }

  const stayCheckbox = (
    <label className="flex items-start gap-2 pt-1" htmlFor="stay-signed-in">
      <input
        id="stay-signed-in"
        type="checkbox"
        checked={staySignedIn}
        onChange={(e) => {
          const on = e.target.checked;
          setStaySignedIn(on);
          setOwnerSessionPersist(on);
        }}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="text-xs leading-relaxed text-muted-foreground">
        Stay signed in on this shop computer. Survives Chrome restart and crash. Uncheck for this
        browser session only. Sign out to end the session.
      </span>
    </label>
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-sm p-6">
        <div className="font-mono text-xs tracking-[0.18em] text-primary">BOLTZ</div>
        <h1 className="mt-1 text-lg font-semibold text-foreground">SEO / GEO Ops</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Internal tooling. Shop agents sign in with a password. Owners can still use a magic link.
        </p>

        {configError && <p className="mt-6 text-sm text-destructive">{configError}</p>}

        {!configError && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-md border border-border p-1">
              {(
                [
                  ["agent", "Shop agent"],
                  ["owner", "Owner magic link"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key);
                    setError(null);
                  }}
                  className={
                    tab === key
                      ? "rounded px-2 py-1.5 text-xs font-medium bg-primary text-primary-foreground"
                      : "rounded px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "agent" ? (
              <form onSubmit={signInWithPassword} className="mt-5 space-y-3">
                <label className="label-caps block" htmlFor="agent-email">
                  Email
                </label>
                <input
                  id="agent-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                  placeholder="agents@boltzautoinc.com"
                />
                <label className="label-caps block" htmlFor="agent-password">
                  Password
                </label>
                <input
                  id="agent-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                />
                {stayCheckbox}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
                {storedAvailable && (
                  <button
                    type="button"
                    onClick={() => void useStoredLogin()}
                    disabled={busy}
                    className="w-full rounded-md border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60"
                  >
                    Use stored shop-agent login
                  </button>
                )}
                {error && <p className="text-xs text-destructive">{error}</p>}
              </form>
            ) : sent ? (
              <p className="mt-5 text-sm text-foreground">
                Check <span className="font-mono">{ownerEmail}</span> for a sign-in link. You can
                close this tab after opening it.
              </p>
            ) : (
              <form onSubmit={sendLink} className="mt-5 space-y-3">
                <label className="label-caps block" htmlFor="owner-email">
                  Owner email
                </label>
                <input
                  id="owner-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                  placeholder="owner@example.com"
                />
                {stayCheckbox}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Send magic link"}
                </button>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
