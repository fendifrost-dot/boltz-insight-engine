import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";
import { resolveOwnerUserWithAgentRestore, urlHasAuthCallback } from "@/lib/owner-session.browser";
import { restorePersistentShopSession } from "@/lib/agent-auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    await ensureSupabaseBrowserConfig();
    if (getSupabaseConfigError()) throw redirect({ to: "/auth" });

    if (
      typeof window !== "undefined" &&
      urlHasAuthCallback(window.location.search, window.location.hash)
    ) {
      await supabase.auth.getSession();
    }

    let user = await resolveOwnerUserWithAgentRestore();

    // The remember cookie is HttpOnly, so only the server can read it. Ask the
    // server to refresh it (or fall back to the stored shop-agent login).
    if (!user) {
      try {
        const restored = await restorePersistentShopSession();
        if (restored?.ok) {
          await supabase.auth.setSession({
            access_token: restored.accessToken,
            refresh_token: restored.refreshToken,
          });
          user = await resolveOwnerUserWithAgentRestore();
        }
      } catch {
        /* fall through to the sign-in page */
      }
    }

    // Only an absent user evicts. A failed staff probe must not wipe the
    // persisted refresh token (that forced a daily magic link).
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: () => <Outlet />,
});
