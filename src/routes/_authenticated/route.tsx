import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";
import {
  resolveOwnerUserWithAgentRestore,
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

    const user = await resolveOwnerUserWithAgentRestore();
    // Only an absent user evicts. Transient errors must not sign anyone out.
    if (!user) throw redirect({ to: "/auth" });

    // A failed staff probe must never sign out — that wiped the refresh token.
    const { data: isStaff, error } = await supabase.rpc("is_staff", { _user_id: user.id });
    if (!error && isStaff === false) {
      throw redirect({ to: "/auth" });
    }

    return { user };
  },

  component: () => <Outlet />,
});
