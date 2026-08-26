import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupabaseConfigError, supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content: "Owner sign-in for the Boltz Automotive internal SEO/GEO operations system.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Sign in — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Owner-only access to the Boltz internal SEO/GEO operations system.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => getSupabaseConfigError());
  const configBlocked = Boolean(getSupabaseConfigError());

  useEffect(() => {
    if (configBlocked) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled && data.session) navigate({ to: "/", replace: true });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not restore session.");
        }
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        navigate({ to: "/", replace: true });
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate, configBlocked]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (configBlocked) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (err) setError(err.message);
      else setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-sm p-6">
        <div className="font-mono text-xs tracking-[0.18em] text-primary">BOLTZ</div>
        <h1 className="mt-1 text-lg font-semibold text-foreground">SEO / GEO Ops</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Internal tooling. Owner access only — sign in with a magic link.
        </p>

        {configBlocked ? (
          <p className="mt-6 text-sm text-destructive">
            {error ?? "Supabase is not configured in this build. Republish from Lovable Cloud."}
          </p>
        ) : sent ? (
          <p className="mt-6 text-sm text-foreground">
            Check <span className="font-mono">{email}</span> for a sign-in link. You can close this
            tab after opening it.
          </p>
        ) : (
          <form onSubmit={sendLink} className="mt-6 space-y-3">
            <label className="label-caps block" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              placeholder="owner@example.com"
            />
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
      </div>
    </main>
  );
}
