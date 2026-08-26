import { createFileRoute } from "@tanstack/react-router";

/**
 * Publishable Supabase URL + anon/publishable key for the browser.
 * Lovable client builds often omit VITE_SUPABASE_* from the JS bundle;
 * the server still has SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY at runtime.
 * Never returns the service-role key.
 */
export const Route = createFileRoute("/api/public/supabase-config")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env["SUPABASE_URL"]?.trim() || "";
        const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"]?.trim() || "";
        if (!url || !anonKey) {
          return Response.json(
            { error: "Supabase public config is not available on the server." },
            { status: 503 },
          );
        }
        return Response.json(
          { url, anonKey },
          {
            headers: {
              "cache-control": "public, max-age=300",
            },
          },
        );
      },
    },
  },
});
