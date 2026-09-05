import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getAgentAuthStatus, signInShopAgent } from "@/lib/agent-auth.functions";
import { publicSignInErrorMessage, RECOMMENDED_AGENT_EMAIL } from "@/lib/agent-auth";
import {
  evaluateLoginRateLimit,
  formatRetryAfter,
  recordLoginFailure,
  recordLoginSuccess,
  type LoginAttemptRecord,
} from "@/lib/login-rate-limit";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";
import {
  applyBrowserSessionTokens,
  resolveAuthorizedOpsUser,
  urlHasAuthCallback,
} from "@/lib/owner-session.browser";
import { readOwnerSessionPersist, setOwnerSessionPersist } from "@/lib/owner-session.storage";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content: "Shop-agent password sign-in and owner magic link for Boltz Automotive internal ops.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Sign in — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Internal access to the Boltz SEO/GEO operations system.",
      },
    ],
  }),
  component: AuthPage,
});

type AuthTab = "agent" | "owner";

const RATE_KEY = "boltz-agent-login:attempts";

function readRateRecord(): LoginAttemptRecord | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(RATE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as LoginAttemptRecord;
    if (
      typeof parsed.failures !== "number" ||
      typeof parsed.windowStartMs !== "number" ||
      typeof parsed.lockedUntilMs !== "number"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeRateRecord(record: LoginAttemptRecord): void {
  try {
    window.sessionStorage.setItem(RATE_KEY, JSON.stringify(record));
  } catch {
    /* storage blocked */
  }
}

function AuthPage() {
  const navigate = useNavigate();
  const agentStatusFn = useServerFn(getAgentAuthStatus);
  const shopAgentFn = useServerFn(signInShopAgent);
  const [configError, setConfigError] = useState<string | null>(null);
  const [tab, setTab] = useState<AuthTab>("agent");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedLoginConfigured, setStoredLoginConfigured] = useState(false);

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

      const user = await resolveAuthorizedOpsUser();
      if (cancelled) return;
      if (user) {
        navigate({ to: "/", replace: true });
        return;
      }

      void agentStatusFn({}).then((status) => {
        if (!cancelled) setStoredLoginConfigured(Boolean(status?.configured));
      });

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (
          session &&
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          urlHasAuthCallback(window.location.search, window.location.hash)
        ) {
          navigate({ to: "/", replace: true });
        }
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // agentStatusFn is a stable server-fn wrapper; omit from deps to avoid remount loops.
  }, [navigate]);

  function persistPreference() {
    setOwnerSessionPersist(staySignedIn);
  }

  function guardRateLimit(): boolean {
    const decision = evaluateLoginRateLimit(readRateRecord(), Date.now());
    writeRateRecord(decision.record);
    if (!decision.allowed) {
      setError(`Too many sign-in attempts. Try again in ${formatRetryAfter(decision.retryAfterMs)}.`);
      return false;
    }
    return true;
  }

  function noteFailure() {
    const current = readRateRecord() ?? { failures: 0, windowStartMs: Date.now(), lockedUntilMs: 0 };
    writeRateRecord(recordLoginFailure(current, Date.now()));
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (configError) {
      setError(configError);
      return;
    }
    if (!guardRateLimit()) return;
    setBusy(true);
    setError(null);
    persistPreference();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPassword("");
    if (err) {
      noteFailure();
      setBusy(false);
      setError(publicSignInErrorMessage(err.message));
      return;
    }
    writeRateRecord(recordLoginSuccess());
    const user = await resolveAuthorizedOpsUser();
    setBusy(false);
    if (!user) {
      setError("This account is not authorized for shop agent access.");
      return;
    }
    navigate({ to: "/", replace: true });
  }

  async function signInStoredAgent() {
    if (configError) {
      setError(configError);
      return;
    }
    if (!guardRateLimit()) return;
    setBusy(true);
    setError(null);
    persistPreference();
    const result = await shopAgentFn({});
    if (!result.ok) {
      noteFailure();
      setBusy(false);
      setError(result.reason);
      return;
    }
    const applied = await applyBrowserSessionTokens(result.session);
    if (!applied) {
      noteFailure();
      setBusy(false);
      setError(publicSignInErrorMessage(undefined));
      return;
    }
    writeRateRecord(recordLoginSuccess());
    setBusy(false);
    navigate({ to: "/", replace: true });
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (configError) {
      setError(configError);
      return;
    }
    setBusy(true);
    setError(null);
    persistPreference();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false,
      },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  const inputClass =
    "w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-ring";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-sm p-6">
        <div className="font-mono text-xs tracking-[0.18em] text-primary">BOLTZ</div>
        <h1 className="mt-1 text-lg font-semibold text-foreground">SEO / GEO Ops</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Shop agents sign in with email and password. Owners can still use a magic link. Stay
          signed in stays on by default so Chrome restart does not drop the session.
        </p>

        {configError && <p className="mt-6 text-sm text-destructive">{configError}</p>}

        {!configError && (
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-md border border-border p-1">
            <button
              type="button"
              onClick={() => {
                setTab("agent");
                setSent(false);
                setError(null);
              }}
              className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === "agent"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              Shop agent
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("owner");
                setError(null);
              }}
              className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === "owner"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              Owner magic link
            </button>
          </div>
        )}

        {!configError && tab === "owner" && sent ? (
          <p className="mt-6 text-sm text-foreground">
            Check <span className="font-mono">{email}</span> for a sign-in link. You can close this
            tab after opening it.
          </p>
        ) : !configError && tab === "owner" ? (
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
              className={inputClass}
              placeholder="info@boltzautoinc.com"
            />
            <StaySignedIn staySignedIn={staySignedIn} setStaySignedIn={setStaySignedIn} />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        ) : !configError ? (
          <form onSubmit={signInWithPassword} className="mt-6 space-y-3">
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
              className={inputClass}
              placeholder={RECOMMENDED_AGENT_EMAIL}
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
              className={inputClass}
            />
            <StaySignedIn staySignedIn={staySignedIn} setStaySignedIn={setStaySignedIn} />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {storedLoginConfigured && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void signInStoredAgent()}
                className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
              >
                {busy ? "Signing in…" : "Use stored shop-agent login"}
              </button>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        ) : null}
      </div>
    </main>
  );
}

function StaySignedIn({
  staySignedIn,
  setStaySignedIn,
}: {
  staySignedIn: boolean;
  setStaySignedIn: (on: boolean) => void;
}) {
  return (
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
}
