import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { EmptyState, PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { Tag, TableWrap, Td, Th } from "@/components/ops/Bits";
import { listEscalations, updateEscalation } from "@/lib/lead-inbox.functions";

export const Route = createFileRoute("/_authenticated/escalations")({
  head: () => ({
    meta: [
      { title: "Escalations · Boltz SEO/GEO Ops" },
      {
        name: "description",
        content: "Human-review queue for high-risk Boltz lead conversations paused by the agent.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EscalationsPage,
});

function EscalationsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listEscalations);
  const updateFn = useServerFn(updateEscalation);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const escalations = useQuery({ queryKey: ["escalations"], queryFn: () => listFn({}) });

  const update = useMutation({
    mutationFn: (args: { id: string; status: "acknowledged" | "resolved" }) =>
      updateFn({ data: { id: args.id, status: args.status, notes: notes[args.id] ?? "" } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["escalations"] }),
  });

  const rows = escalations.data ?? [];

  return (
    <Shell>
      <PageHeader
        kicker="Human control"
        title="Escalations"
        description="The agent halts automated replies and hands the thread to a human whenever a safety rule fires."
      />
      <Panel title="Queue" meta={`${rows.length} records`}>
        {escalations.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading escalations…</p>
        ) : rows.length === 0 ? (
          <EmptyState label="No escalations" hint="Safety rules have not fired on any thread yet." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Lead</Th>
                  <Th>Category</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const lead = (row as { leads?: { name: string | null; phone_e164: string | null } })
                    .leads;
                  return (
                    <tr key={row.id}>
                      <Td>
                        <div className="font-medium">{lead?.name ?? "Unnamed"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {lead?.phone_e164 ?? "Not entered"}
                        </div>
                      </Td>
                      <Td>
                        <Tag tone="warning">{row.category}</Tag>
                      </Td>
                      <Td className="max-w-sm text-xs">{row.reason}</Td>
                      <Td>
                        <Tag tone={row.status === "resolved" ? "success" : "danger"}>{row.status}</Tag>
                      </Td>
                      <Td>
                        <div className="space-y-1">
                          <input
                            value={notes[row.id] ?? row.resolution_notes ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                            placeholder="Resolution notes"
                            className="w-48 rounded border border-border bg-input px-2 py-1 text-xs"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={() => update.mutate({ id: row.id, status: "acknowledged" })}
                              disabled={row.status !== "open"}
                              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                            >
                              Acknowledge
                            </button>
                            <button
                              onClick={() => update.mutate({ id: row.id, status: "resolved" })}
                              disabled={row.status === "resolved"}
                              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                            >
                              Resolve
                            </button>
                          </div>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </Shell>
  );
}
