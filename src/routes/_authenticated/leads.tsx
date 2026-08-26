import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { EmptyState, PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { Tag, Td, Th, TableWrap } from "@/components/ops/Bits";
import {
  assertSendDestination,
  displayPhone,
  resolveThreadSync,
} from "@/lib/lead-inbox-thread-sync";
import {
  getThread,
  listLeads,
  sendOwnerMessage,
  setThreadControl,
  startOwnerSms,
} from "@/lib/lead-inbox.functions";

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

type SelectedLead = {
  id: string;
  name: string | null;
  phone_e164: string | null;
};

function LeadsPage() {
  const queryClient = useQueryClient();
  // Selection is the clicked row identity (id + phone) — never list index.
  const [selected, setSelected] = useState<SelectedLead | null>(null);
  const [draft, setDraft] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");

  const leadsFn = useServerFn(listLeads);
  const threadFn = useServerFn(getThread);
  const sendFn = useServerFn(sendOwnerMessage);
  const controlFn = useServerFn(setThreadControl);
  const startFn = useServerFn(startOwnerSms);

  const selectedId = selected?.id ?? null;

  const leads = useQuery({ queryKey: ["leads"], queryFn: () => leadsFn({}) });
  const thread = useQuery({
    queryKey: ["lead-thread", selectedId],
    queryFn: () => {
      if (!selectedId) throw new Error("No lead selected");
      return threadFn({ data: { leadId: selectedId } });
    },
    enabled: Boolean(selectedId),
    placeholderData: undefined,
  });

  const loadedLead = thread.data?.lead ?? null;
  const loadedThread = thread.data?.thread ?? null;

  // Do not treat background refetch of the *same* lead as desync.
  const threadQueryPending =
    Boolean(selectedId) && (thread.isPending || !loadedLead || loadedLead.id !== selectedId);

  const sync = resolveThreadSync({
    selectedLeadId: selectedId,
    selectedRowPhone: selected?.phone_e164 ?? null,
    selectedRowName: selected?.name ?? null,
    loadedLead,
    loadedThread,
    threadQueryPending,
  });

  const headerPhone = sync.destinationPhone;

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!selected || !loadedLead || !loadedThread || !headerPhone) {
        throw new Error("No thread loaded");
      }
      const guard = assertSendDestination({
        selectedLeadId: selected.id,
        selectedRowPhone: selected.phone_e164 ?? "",
        loadedLeadId: loadedLead.id,
        loadedThreadId: loadedThread.id,
        loadedThreadLeadId: loadedThread.lead_id,
        destinationPhone: headerPhone,
        headerPhone,
      });
      if (!guard.ok) throw new Error(guard.reason);
      return sendFn({
        data: {
          leadId: loadedLead.id,
          threadId: loadedThread.id,
          text,
          expectedPhone: headerPhone,
        },
      });
    },
    onSuccess: (result) => {
      if (result.ok) setDraft("");
      if (selectedId) {
        void queryClient.invalidateQueries({ queryKey: ["lead-thread", selectedId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const selectLead = (lead: {
    id: string;
    name: string | null;
    phone_e164: string | null;
  }) => {
    // Capture id + phone from THIS row at click time (not visual index).
    setSelected({
      id: lead.id,
      name: lead.name,
      phone_e164: lead.phone_e164,
    });
    setDraft("");
    send.reset();
  };

  const control = useMutation({
    mutationFn: async (mode: "auto" | "human") => {
      if (!sync.inSync || !loadedThread || loadedThread.lead_id !== selectedId) {
        throw new Error("Thread not in sync");
      }
      return controlFn({ data: { threadId: loadedThread.id, mode } });
    },
    onSuccess: () => {
      if (selectedId) {
        void queryClient.invalidateQueries({ queryKey: ["lead-thread", selectedId] });
      }
    },
  });

  const startNew = useMutation({
    mutationFn: async () =>
      startFn({
        data: {
          phone: newPhone.trim(),
          text: newText.trim(),
          name: newName.trim() || undefined,
          leadSource: "owner_outbound",
          markConsentOptIn: true,
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) return;
      const startedName = newName.trim() || null;
      const startedPhone = newPhone.trim() || null;
      setNewPhone("");
      setNewName("");
      setNewText("");
      setComposeOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      if (result.leadId) {
        setDraft("");
        setSelected({
          id: result.leadId,
          name: startedName,
          phone_e164: startedPhone,
        });
        void queryClient.invalidateQueries({ queryKey: ["lead-thread", result.leadId] });
      }
    },
  });

  const rows = leads.data ?? [];
  const canStart =
    newPhone.trim().length >= 7 && newText.trim().length > 0 && !startNew.isPending;
  const canSend =
    sync.canCompose && draft.trim().length > 0 && !send.isPending && Boolean(loadedThread);

  const threadPanelTitle = selected
    ? sync.headerName ?? selected.name ?? "Unnamed"
    : "Thread";
  const threadPanelMeta = selected ? (
    <span className="font-mono normal-case tracking-normal text-foreground">
      {displayPhone(headerPhone ?? selected.phone_e164)}
      {sync.inSync && loadedThread ? ` · ${loadedThread.control_mode}` : sync.showLoading ? " · loading" : ""}
    </span>
  ) : undefined;

  return (
    <Shell>
      <PageHeader
        kicker="Lead operations"
        title="Lead Inbox"
        description="RingCentral SMS on +17085754555. Start a new outbound for Durable/web leads that have not texted in yet, or reply inside an existing thread."
        actions={
          <button
            type="button"
            onClick={() => setComposeOpen((open) => !open)}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {composeOpen ? "Close compose" : "New SMS"}
          </button>
        }
      />

      {composeOpen && (
        <Panel title="New SMS" meta="Shop line +17085754555" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <span className="label-caps">Destination phone</span>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(312) 487-6842"
                className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
                autoComplete="tel"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="label-caps">Name (optional)</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Network group"
                className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="mt-3 block space-y-1 text-xs">
            <span className="label-caps">Message</span>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={3}
              maxLength={480}
              placeholder="First reply — sent immediately via RingCentral"
              className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
            />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Creates the lead/thread if missing. Opted-out numbers are blocked. Sending asserts SMS
            consent for this outreach (e.g. Durable form opt-in).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => startNew.mutate()}
              disabled={!canStart}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              {startNew.isPending ? "Sending…" : "Send new SMS"}
            </button>
            {startNew.data && !startNew.data.ok && (
              <span className="text-xs text-destructive">{startNew.data.reason}</span>
            )}
            {startNew.isError && (
              <span className="text-xs text-destructive">Could not start conversation.</span>
            )}
            {startNew.data?.ok && (
              <span className="text-xs text-muted-foreground">Sent — thread selected below.</span>
            )}
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
              hint="Use New SMS for Durable/web leads, or wait for an inbound text to +17085754555."
            />
          ) : (
            // TableWrap already renders <table> — do NOT nest another <table>
            // (nested tables remap click targets → wrong lead / wrong route).
            <TableWrap>
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
                {rows.map((lead) => {
                  const isSelected = selectedId === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      data-lead-id={lead.id}
                      data-lead-phone={lead.phone_e164 ?? ""}
                      className={
                        isSelected
                          ? "cursor-pointer bg-secondary/60"
                          : "cursor-pointer hover:bg-secondary/30"
                      }
                    >
                      <Td>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            selectLead({
                              id: lead.id,
                              name: lead.name,
                              phone_e164: lead.phone_e164,
                            });
                          }}
                        >
                          <div className="font-medium text-foreground">{lead.name ?? "Unnamed"}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {lead.phone_e164 ?? "Not entered"}
                          </div>
                        </button>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            selectLead({
                              id: lead.id,
                              name: lead.name,
                              phone_e164: lead.phone_e164,
                            });
                          }}
                        >
                          {[lead.vehicle_year, lead.vehicle_make, lead.vehicle_model]
                            .filter(Boolean)
                            .join(" ") || "Not entered"}
                        </button>
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
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel title={threadPanelTitle} meta={threadPanelMeta}>
          {!selected ? (
            <EmptyState
              label="Select a lead"
              hint="Or use New SMS to text a number that is not listed yet."
            />
          ) : (
            <div className="space-y-4">
              {/* Always-visible destination header — name + phone before compose. */}
              <div className="rounded border border-primary/40 bg-primary/10 px-3 py-2">
                <div className="label-caps mb-1">Sending to</div>
                <div className="text-sm font-medium text-foreground">
                  {sync.headerName ?? selected.name ?? "Unnamed"}
                </div>
                <div className="font-mono text-sm text-foreground">
                  {displayPhone(headerPhone ?? selected.phone_e164)}
                </div>
                {!sync.canCompose && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {sync.blockReason ?? "Loading conversation before send is enabled…"}
                  </p>
                )}
              </div>

              {sync.showLoading || !sync.inSync ? (
                <p className="text-sm text-muted-foreground">
                  {sync.blockReason ?? "Loading the selected conversation…"}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => control.mutate("human")}
                      disabled={loadedThread?.control_mode === "human" || control.isPending}
                      className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Take over (human)
                    </button>
                    <button
                      type="button"
                      onClick={() => control.mutate("auto")}
                      disabled={loadedThread?.control_mode === "auto" || control.isPending}
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
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      maxLength={480}
                      disabled={!sync.canCompose}
                      placeholder={`Message to ${displayPhone(headerPhone)}`}
                      className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm disabled:opacity-40"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => send.mutate(draft)}
                        disabled={!canSend}
                        className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                      >
                        {send.isPending
                          ? "Sending…"
                          : `Send SMS to ${displayPhone(headerPhone)}`}
                      </button>
                      {send.data && !send.data.ok && (
                        <span className="text-xs text-destructive">{send.data.reason}</span>
                      )}
                      {send.isError && (
                        <span className="text-xs text-destructive">
                          {send.error instanceof Error ? send.error.message : "Send failed."}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="label-caps mb-1">Agent runs</div>
                    {(thread.data?.agentRuns ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No agent runs yet.</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {thread.data?.agentRuns.map((run) => (
                          <li key={run.id} className="rounded border border-border px-2 py-1">
                            <span className="font-mono text-foreground">{run.action}</span> ·{" "}
                            {run.model} · {fmt(run.created_at)}
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
                          <span className="font-mono">{event.event_type}</span> ·{" "}
                          {event.actor ?? "system"} · {fmt(event.created_at)}
                          {event.summary ? ` — ${event.summary}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
