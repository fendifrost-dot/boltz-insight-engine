import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { EmptyState, PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { Tag, Td, Th, TableWrap } from "@/components/ops/Bits";
import {
  getThread,
  listLeads,
  sendOwnerMessage,
  setThreadControl,
  startOwnerSms,
} from "@/lib/lead-inbox.functions";
import {
  assertSendDestination,
  displayPhone,
  resolveThreadSync,
} from "@/lib/lead-inbox-thread-sync";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Lead Inbox · Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Internal Boltz lead inbox: RingCentral SMS threads, Grok agent activity, and lifecycle state.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LeadsPage,
});

function fmt(value: string | null | undefined): string {
  if (!value) return "Not entered";
  return new Date(value).toLocaleString();
}

function LeadsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");

  const leadsFn = useServerFn(listLeads);
  const threadFn = useServerFn(getThread);
  const sendFn = useServerFn(sendOwnerMessage);
  const controlFn = useServerFn(setThreadControl);
  const startFn = useServerFn(startOwnerSms);

  const leads = useQuery({ queryKey: ["leads"], queryFn: () => leadsFn({}) });
  const thread = useQuery({
    queryKey: ["lead-thread", selected],
    queryFn: () => threadFn({ data: { leadId: selected as string } }),
    enabled: Boolean(selected),
  });

  const loadedLead = thread.data?.lead ?? null;
  const loadedThread = thread.data?.thread ?? null;
  const threadQueryPending = Boolean(
    selected && (thread.isPending || thread.isFetching || !loadedLead || loadedLead.id !== selected),
  );
  const sync = resolveThreadSync({
    selectedLeadId: selected,
    loadedLead,
    loadedThread,
    threadQueryPending,
  });
  const headerPhone = loadedLead?.phone_e164 ?? null;

  const send = useMutation({
    mutationFn: async (text: string) => {
      const check = assertSendDestination({
        selectedLeadId: selected,
        loadedLead,
        loadedThread,
        headerPhone,
      });
      if (!check.ok) throw new Error(check.reason);
      return sendFn({
        data: {
          leadId: check.leadId,
          threadId: check.threadId,
          text,
          expectedPhone: headerPhone ?? undefined,
        },
      });
    },
    onSuccess: (result) => {
      if (result.ok) setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["lead-thread", selected] });
    },
  });

  const control = useMutation({
    mutationFn: async (mode: "auto" | "human") => {
      if (!loadedThread || !sync.inSync) throw new Error("No thread selected");
      return controlFn({ data: { threadId: loadedThread.id, mode } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["lead-thread", selected] }),
  });


  const startSms = useMutation({
    mutationFn: async () =>
      startFn({
        data: {
          phone: newPhone,
          text: newText,
          name: newName || undefined,
        },
      }),
    onSuccess: (result) => {
      if (result.ok && result.leadId) {
        setNewPhone("");
        setNewName("");
        setNewText("");
        setShowCompose(false);
        void queryClient.invalidateQueries({ queryKey: ["leads"] });
        setSelected(result.leadId);
      }
    },
  });

  const rows = leads.data ?? [];

  return (
    <Shell>
      <PageHeader
        kicker="Lead operations"
        title="Lead Inbox"
        description="RingCentral SMS threads with autonomous Grok replies. Human control is for takeovers and escalations only."
        actions={
          <button
            onClick={() => setShowCompose((s) => !s)}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
          >
            {showCompose ? "Cancel" : "New SMS"}
          </button>
        }
      />

      {showCompose && (
        <Panel title="Start new SMS" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div>
              <label className="label-caps mb-1 block">Phone</label>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+1 (312) 555-0100"
                className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="label-caps mb-1 block">Name (optional)</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Lead name"
                className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label-caps mb-1 block">Message</label>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={3}
              maxLength={480}
              placeholder="Owner message (sent immediately via RingCentral)"
              className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => startSms.mutate()}
              disabled={newPhone.trim().length === 0 || newText.trim().length === 0 || startSms.isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              {startSms.isPending ? "Sending…" : "Send new SMS"}
            </button>
            {startSms.data && !startSms.data.ok && (
              <span className="text-xs text-destructive">{startSms.data.reason}</span>
            )}
            {startSms.isError && <span className="text-xs text-destructive">Start SMS failed.</span>}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Panel title="Leads" meta={`${rows.length} records`}>
          {leads.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading leads…</p>
          ) : leads.isError ? (
            <p className="text-sm text-destructive">Could not load leads.</p>
          ) : rows.length === 0 ? (
            <EmptyState
              label="No leads yet"
              hint="Leads appear when RingCentral delivers an inbound SMS, or use New SMS to start outreach to a Durable lead."
            />

          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Lead</Th>
                    <Th>Vehicle</Th>
                    <Th>Lifecycle</Th>
                    <Th>Consent</Th>
                    <Th>Last message</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => {
                        setSelected(lead.id);
                        setDraft("");
                        send.reset();
                      }}
                      className={
                        selected === lead.id
                          ? "cursor-pointer bg-secondary/60"
                          : "cursor-pointer hover:bg-secondary/30"
                      }
                    >
                      <Td>
                        <div className="font-medium text-foreground">{lead.name ?? "Unnamed"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {lead.phone_e164 ?? "Not entered"}
                        </div>
                      </Td>
                      <Td>
                        {[lead.vehicle_year, lead.vehicle_make, lead.vehicle_model]
                          .filter(Boolean)
                          .join(" ") || "Not entered"}
                      </Td>
                      <Td>
                        <Tag tone="info">{lead.lifecycle}</Tag>
                      </Td>
                      <Td>
                        <Tag tone={lead.consent_status === "opted_out" ? "danger" : "neutral"}>
                          {lead.consent_status}
                        </Tag>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmt(lead.last_message_at)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>

        <Panel
          title="Thread"
          meta={sync.inSync && loadedThread ? `control: ${loadedThread.control_mode}` : undefined}
        >
          {!selected ? (
            <EmptyState label="Select a lead" hint="Thread, agent decisions and audit trail appear here." />
          ) : !sync.inSync ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {sync.showLoading ? "Loading the selected conversation…" : "Conversation unavailable."}
              </p>
              {sync.blockReason && <p className="text-xs text-destructive">{sync.blockReason}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded border border-primary/40 bg-primary/10 p-2">
                <div className="label-caps mb-1">Sending to</div>
                <div className="text-sm font-medium text-foreground">{sync.headerName}</div>
                <div className="font-mono text-xs text-muted-foreground">{displayPhone(headerPhone)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => control.mutate("human")}
                  disabled={loadedThread?.control_mode === "human"}
                  className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                >
                  Take over (human)
                </button>
                <button
                  onClick={() => control.mutate("auto")}
                  disabled={loadedThread?.control_mode === "auto"}
                  className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                >
                  Return to agent
                </button>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto rounded border border-border p-3">
                {(thread.data?.messages ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages in this thread.</p>
                ) : (
                  thread.data?.messages.map((m) => (
                    <div
                      key={m.id}
                      className={
                        m.direction === "inbound"
                          ? "rounded bg-secondary/50 p-2"
                          : "rounded border border-primary/30 bg-primary/10 p-2"
                      }
                    >
                      <div className="label-caps mb-1 flex gap-2">
                        <span>{m.direction}</span>
                        <span>{m.delivery_state}</span>
                        <span>{fmt(m.created_at)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-foreground">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                {!sync.canCompose ? (
                  <p className="text-xs text-destructive">{sync.blockReason}</p>
                ) : (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    maxLength={480}
                    placeholder={`Message to ${sync.headerName} at ${displayPhone(headerPhone)} (sent immediately via RingCentral)`}
                    className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
                  />
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => send.mutate(draft)}
                    disabled={draft.trim().length === 0 || send.isPending || !sync.canCompose}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {send.isPending ? "Sending…" : `Send SMS to ${displayPhone(headerPhone)}`}
                  </button>
                  {send.data && !send.data.ok && (
                    <span className="text-xs text-destructive">{send.data.reason}</span>
                  )}
                  {send.isError && <span className="text-xs text-destructive">Send failed.</span>}
                </div>
              </div>

              <div>
                <div className="label-caps mb-1">Agent decisions</div>
                {(thread.data?.agentRuns ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No agent runs yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {thread.data?.agentRuns.map((run) => (
                      <li key={run.id} className="rounded border border-border px-2 py-1">
                        <span className="font-mono text-foreground">{run.action}</span> · {run.model} ·{" "}
                        {fmt(run.created_at)}
                        {run.audit_summary ? ` — ${run.audit_summary}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="label-caps mb-1">Audit trail</div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {(thread.data?.events ?? []).map((event) => (
                    <li key={event.id}>
                      <span className="font-mono">{event.event_type}</span> · {event.actor ?? "system"} ·{" "}
                      {fmt(event.created_at)}
                      {event.summary ? ` — ${event.summary}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
