// TEMPORARY one-off route: mirrors the AGENT_AUTH_* values already present in
// the server environment into the encrypted Vault, so the stored shop-agent
// login path uses the same credentials as the account. Localhost only.
// Delete after use. Never returns secret values.
import { createFileRoute } from "@tanstack/react-router";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export const Route = createFileRoute("/api/public/sync-vault-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const host = request.headers.get("host") ?? "";
        if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
          return new Response("Not found", { status: 404 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const synced: string[] = [];
        for (const name of ["AGENT_AUTH_EMAIL", "AGENT_AUTH_PASSWORD"]) {
          const value = readEnv(name);
          if (!value) continue;
          const { error } = await supabaseAdmin.rpc("write_agent_auth_secret", {
            secret_name: name,
            secret_value: value,
          });
          if (error) {
            return Response.json({ ok: false, error: `write failed for ${name}` }, { status: 500 });
          }
          synced.push(name);
        }
        return Response.json({ ok: true, synced });
      },
    },
  },
});
