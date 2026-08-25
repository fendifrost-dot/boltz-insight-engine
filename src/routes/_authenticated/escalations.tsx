import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { Tag } from "@/components/ops/Bits";
import { listEscalationsFn, resolveEscalationFn } from "@/server/functions/lead-inbox";

export const Route = createFileRoute("/_authenticated/escalations")({
  head: () => ({
    meta: [{ title: "Escalations — Lead Inbox" }],
  }),
  component: EscalationsPage,
});

function EscalationsPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["escalations", "open"],
    queryFn: () => listEscalationsFn({ data: { status: "open" } }),
  });

  const resolveMutation = useMutation({
    mutationFn: (input: {
      escalationId: string;
      status: "acknowledged" | "resolved";
      notes?: string;
    }) =>
      resolveEscalationFn({
        data: {
          escalationId: input.escalationId,
          status: input.status,
          resolutionNotes: input.notes ?? null,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["escalations"] });
    },
  });

  return (
    <Shell>
      <PageHeader
        kicker="Operate"
        title="Escalations"
        description="High-risk threads switched to human control. Not a message-approval queue."
        actions={
          <Link to="/leads" className="rounded-md border border-border px-3 py-1.5 text-xs">
            Back to inbox
          </Link>
        }
      />
      <Panel title="Open escalations">
        {query.isLoading ? (
          <EmptyState label="Loading…" />
        ) : (query.data?.items ?? []).length === 0 ? (
          <EmptyState label="No open escalations." />
        ) : (
          <ul className="space-y-3">
            {query.data!.items.map((e) => {
              const lead = (e as { leads?: { name?: string | null; phone_e164?: string | null } })
                .leads;
              return (
                <li key={e.id} className="rounded-md border border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="danger">{e.category}</Tag>
                    <span className="text-sm text-foreground">
                      {lead?.name ?? "Not entered"} · {lead?.phone_e164 ?? "Not entered"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{e.reason}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs"
                      onClick={() =>
                        resolveMutation.mutate({ escalationId: e.id, status: "acknowledged" })
                      }
                    >
                      Acknowledge
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
                      onClick={() =>
                        resolveMutation.mutate({
                          escalationId: e.id,
                          status: "resolved",
                          notes: "Resolved by owner",
                        })
                      }
                    >
                      Resolve
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </Shell>
  );
}
