import { createFileRoute } from "@tanstack/react-router";
import { getCronSecret } from "@/lib/server/env.server";
import { renewDueSubscriptions } from "@/server/lead-inbox/inbound.server";

export const Route = createFileRoute("/api/cron/renew-subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCron(request)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const result = await renewDueSubscriptions();
        return Response.json({ ok: true, ...result });
      },
    },
  },
});

function authorizeCron(request: Request): boolean {
  try {
    const secret = getCronSecret();
    const header = request.headers.get("authorization") ?? "";
    return header === `Bearer ${secret}`;
  } catch {
    return false;
  }
}
