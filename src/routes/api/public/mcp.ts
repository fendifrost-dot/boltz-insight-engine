import { createFileRoute } from "@tanstack/react-router";

/**
 * Remote MCP connector for Boltz bots.
 * Auth: Authorization: Bearer <per-agent token>. The token is stored only as a hash.
 * The bot API header, the cron bearer, and staff session JWTs are not accepted.
 */
async function handle(request: Request): Promise<Response> {
  try {
    const { handleMcpRequest } = await import("@/server/mcp/handler");
    const { createSupabaseMcpStore } = await import("@/server/mcp/store.server");
    const { createBoltzMcpTools } = await import("@/server/mcp/tools.server");
    return await handleMcpRequest(request, {
      store: createSupabaseMcpStore(),
      tools: createBoltzMcpTools(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "mcp request failed";
    console.error("[mcp]", message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200));
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "request failed" } },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
      OPTIONS: async ({ request }) => handle(request),
    },
  },
});
