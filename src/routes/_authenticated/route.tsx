import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";
import { restorePersistentShopSession } from "@/lib/agent-auth.functions";
import {
  applyBrowserSessionTokens,
  resolveAuthorizedOpsUser,
  urlHasAuthCallback,
} from "@/lib/owner-session.browser";

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
    const user = await resolveAuthorizedOpsUser();
    if (user) return { user };

    // Chrome quit drops localStorage. The remember cookie is HttpOnly, so
    // document.cookie cannot restore it — the server reads the Cookie header
    // (or Vault shop-agent login) and returns tokens.
    const restored = await restorePersistentShopSession({});
    if (restored.ok) {
      const applied = await applyBrowserSessionTokens(restored.session);
      if (applied) {
        const recovered = await resolveAuthorizedOpsUser();
        if (recovered) return { user: recovered };
      }
    }
    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});
