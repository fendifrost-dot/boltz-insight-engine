import { createFileRoute } from "@tanstack/react-router";
import { DeskShell } from "@/components/desk/DeskShell";

export const Route = createFileRoute("/_authenticated/desk/chat")({
  validateSearch: (search: Record<string, unknown>): { leadId?: string | undefined } => ({
    leadId:
      typeof search["leadId"] === "string" && /^[0-9a-f-]{36}$/i.test(search["leadId"])
        ? search["leadId"]
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "Grok chat · Boltz" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => <DeskShell fullChat />,
});
