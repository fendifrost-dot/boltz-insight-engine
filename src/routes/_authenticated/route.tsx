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
    try {
      if (
        typeof window !== "undefined" &&
        urlHasAuthCallback(window.location.search, window.location.hash)
      ) {
        await supabase.auth.getSession();
      }
      const user = await resolveOwnerUser();
      if (!user) throw redirect({ to: "/auth" });
      return { user };
    } catch {
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
