import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
  ensureSupabaseBrowserConfig,
  getSupabaseConfigError,
  supabase,
} from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    await ensureSupabaseBrowserConfig();
    if (getSupabaseConfigError()) throw redirect({ to: "/auth" });
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw redirect({ to: "/auth" });
      return { user: data.user };
    } catch {
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
