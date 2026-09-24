import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { EmptyState, PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { Tag, Td, Th, TableWrap } from "@/components/ops/Bits";
import {
  LEAD_SOURCE_FILTERS,
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

type SelectedRow = { id: string; name: string | null; phone_e164: string | null };
type SourceFilter = (typeof LEAD_SOURCE_FILTERS)[number];

const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: "All sources",
  meta: "Facebook + Instagram",
  facebook: "Facebook",
  instagram: "Instagram",
};

/** Latest Grok first-touch draft for a Meta lead, if one was recorded. */
function firstTouchDraft(runs: { prompt_version: string; raw_decision: unknown }[]): string | null {
  for (const run of runs) {
    if (run.prompt_version !== "boltz-meta-first-touch-v1") continue;
    const draft = (run.raw_decision as { draft_text?: unknown } | null)?.draft_text;
    if (typeof draft === "string" && draft.trim()) return draft;
  }
  return null;
}

function LeadsPage() {
  const queryClient = useQueryClient();
  const [selectedRow, setSelectedRow] = useState<SelectedRow | null>(null);
  const [draft, setDraft] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");

  const selected = selectedRow?.id ?? null;

  const leadsFn = useServerFn(listLeads);
  const threadFn = useServerFn(getThread);
  const sendFn = useServerFn(sendOwnerMessage);
  const controlFn = useServerFn(setThreadControl);
  const startFn = useServerFn(startOwnerSms);

  const leads = useQuery({
    queryKey: ["leads", source],
    queryFn: () => leadsFn({ data: { source } }),
  });
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
    selectedRowPhone: selectedRow?.phone_e164 ?? null,
    selectedRowName: selectedRow?.name ?? null,
    loadedLead,
    loadedThread,
    threadQueryPending,
  });
  const headerPhone = selectedRow?.phone_e164 ?? null;


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
      const startedName = newName;
      const startedPhone = newPhone;
      if (result.ok && result.leadId) {
        setNewPhone("");
        setNewName("");
        setNewText("");
        setShowCompose(false);
        void queryClient.invalidateQueries({ queryKey: ["leads"] });
        setSelectedRow({
          id: result.leadId,
          name: startedName || null,
          phone_e164: startedPhone || null,
        });

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
        <Panel
          title="Leads"
          meta={
            <span className="flex items-center gap-2">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as SourceFilter)}
                aria-label="Lead source"
                className="rounded border border-border bg-input px-1.5 py-0.5 text-xs"
              >
                {LEAD_SOURCE_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {SOURCE_LABEL[value]}
                  </option>
                ))}
              </select>
              <span>{`${rows.length} records`}</span>
            </span>
          }
        >
          {leads.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading leads…</p>
          ) : leads.isError ? (
            <p className="text-sm text-destructive">Could not load leads.</p>
          ) : rows.length === 0 ? (
            <EmptyState
              label="No leads yet"
              hint={
                source === "all"
                  ? "Leads appear when RingCentral delivers an inbound SMS or a Facebook/Instagram Lead Ad form is submitted, or use New SMS to start outreach to a Durable lead."
                  : `No ${SOURCE_LABEL[source]} Lead Ads leads yet.`
              }
            />

          ) : (
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
                  const selectRow = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedRow({
                      id: lead.id,
                      name: lead.name ?? null,
                      phone_e164: lead.phone_e164 ?? null,
                    });
                    setDraft("");
                    send.reset();
                  };
                  return (
                    <tr
                      key={lead.id}
                      className={
                        selected === lead.id ? "bg-secondary/60" : "hover:bg-secondary/30"
                      }
                    >
                      <Td>
                        <button
                          type="button"
                          onClick={selectRow}
                          className="block w-full text-left"
                        >
                          <div className="font-medium text-foreground">{lead.name ?? "Unnamed"}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {lead.phone_e164 ?? lead.email ?? "Not entered"}
                          </div>
                          {lead.meta_platforms.length > 0 && (
                            <div className="mt-1 flex gap-1">
                              {lead.meta_platforms.map((platform) => (
                                <Tag key={platform} tone="info">
                                  {platform === "instagram" ? "Instagram lead" : "Facebook lead"}
                                </Tag>
                              ))}
                            </div>
                          )}
                        </button>
                      </Td>
                      <Td>
                        <button type="button" onClick={selectRow} className="block w-full text-left">
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

        <Panel
          title={selectedRow ? (sync.headerName || "Unnamed") : "Thread"}
          meta={
            selectedRow ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-foreground">{displayPhone(headerPhone)}</span>
                {sync.inSync && loadedThread && (
                  <span className="label-caps">control: {loadedThread.control_mode}</span>
                )}
              </span>
            ) : undefined
          }
        >
          {!selected ? (
            <EmptyState label="Select a lead" hint="Thread, agent runs and audit trail appear here." />
          ) : (
            <div className="space-y-4">
              <div className="rounded border border-primary/40 bg-primary/10 p-2">
                <div className="label-caps mb-1">Sending to</div>
                <div className="text-sm font-medium text-foreground">{sync.headerName || "Unnamed"}</div>
                <div className="font-mono text-xs text-muted-foreground">{displayPhone(headerPhone)}</div>
              </div>
              {!sync.inSync ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {sync.showLoading ? "Loading the selected conversation…" : "Conversation unavailable."}
                  </p>
                  {sync.blockReason && <p className="text-xs text-destructive">{sync.blockReason}</p>}
                </div>
              ) : (
            <div className="space-y-4">

              {(thread.data?.metaSubmissions ?? []).length > 0 && (
                <div className="rounded border border-border p-2">
                  <div className="label-caps mb-1">Meta Lead Ads</div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {thread.data?.metaSubmissions.map((sub) => (
                      <li key={sub.id}>
                        <Tag tone="info">{sub.platform ?? "meta"}</Tag>{" "}
                        <span className="font-mono">{sub.meta_lead_id}</span> · {fmt(sub.created_time)} ·{" "}
                        {sub.ingestion_method}
                        {sub.form_name ? ` · form ${sub.form_name}` : ""}
                        {sub.campaign_name || sub.campaign_id
                          ? ` · campaign ${sub.campaign_name ?? sub.campaign_id}`
                          : ""}
                        {sub.ad_name || sub.ad_id ? ` · ad ${sub.ad_name ?? sub.ad_id}` : ""}
                        {sub.consent_version ? ` · consent ${sub.consent_version}` : " · no consent text on form"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(() => {
                const draftText = firstTouchDraft(thread.data?.agentRuns ?? []);
                const hasOutbound = (thread.data?.messages ?? []).some((m) => m.direction === "outbound");
                if (!draftText || hasOutbound || !sync.canCompose) return null;
                return (
                  <div className="rounded border border-primary/40 p-2">
                    <div className="label-caps mb-1">Grok first-touch draft (not sent)</div>
                    <p className="text-sm whitespace-pre-wrap text-foreground">{draftText}</p>
                    <button
                      onClick={() => setDraft(draftText)}
                      className="mt-2 rounded border border-border px-2 py-1 text-xs"
                    >
                      Use draft
                    </button>
                    {loadedLead?.consent_status !== "opted_in" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No SMS consent was captured on the form. Confirm the customer expects a text before sending.
                      </p>
                    )}
                  </div>
                );
              })()}

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
                <div className="label-caps mb-1">Agent runs</div>
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
            </div>
          )}

        </Panel>
      </div>
    </Shell>
  );
}
