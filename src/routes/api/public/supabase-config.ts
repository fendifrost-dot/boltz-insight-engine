import { createFileRoute } from "@tanstack/react-router";

// Publishable (anon) config only — never the service role key.
export const Route = createFileRoute("/api/public/supabase-config")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env["SUPABASE_URL"] ?? "";
        const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";

        if (!url || !anonKey) {
          return Response.json(
            { error: "Supabase public configuration unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }

        return Response.json(
          { url, anonKey },
          { headers: { "cache-control": "public, max-age=300" } },
        );
      },
    },
  },
});
