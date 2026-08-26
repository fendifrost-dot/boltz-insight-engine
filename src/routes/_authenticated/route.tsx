import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSupabaseConfigError, supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Prefer a controlled redirect over an uncaught throw that blanks the app
    // behind the root "This page didn't load" boundary.
    if (getSupabaseConfigError()) {
      throw redirect({ to: "/auth" });
    }
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw redirect({ to: "/auth" });
      return { user: data.user };
    } catch (error) {
      if (error && typeof error === "object" && "to" in error) throw error;
      console.error(error);
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
