import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";
import { resolveOwnerUser, urlHasAuthCallback } from "@/lib/owner-session.browser";

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

    const user = await resolveOwnerUser();
    // Only an absent user evicts. Transient errors must not sign anyone out.
    if (!user) throw redirect({ to: "/auth" });

    const { data: isStaff, error } = await supabase.rpc("is_staff", { _user_id: user.id });
    if (!error && isStaff === false) {
      await supabase.auth.signOut({ scope: "local" });
      throw redirect({ to: "/auth" });
    }

    return { user };
  },
  component: () => <Outlet />,
});
