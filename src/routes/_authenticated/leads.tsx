import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { Stat, Tag } from "@/components/ops/Bits";
import { LEAD_LIFECYCLES } from "@/lib/lead-inbox/constants";
import {
  getLeadDashboardCountsFn,
  getLeadThreadFn,
  listLeadsFn,
  sendManualMessageFn,
  setThreadControlModeFn,
  startConversationFn,
  updateLeadFn,
} from "@/server/functions/lead-inbox";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Lead Inbox — Boltz Ops" },
      {
        name: "description",
        content: "Private RingCentral SMS lead inbox for Boltz Automotive.",
      },
    ],
  }),
  component: LeadInboxPage,
});

function display(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Not entered";
  return String(value);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/40 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

function LeadInboxPage() {
  const qc = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [controlMode, setControlMode] = useState<"" | "auto" | "human">("");
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [composer, setComposer] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newBody, setNewBody] = useState("");
  const [showNew, setShowNew] = useState(false);

  const filters = useMemo(
    () => ({
      page: 1,
      pageSize: 50,
      q: q || undefined,
      lifecycle: lifecycle || undefined,
      unreadOnly: unreadOnly || undefined,
      controlMode: controlMode || undefined,
      escalatedOnly: escalatedOnly || undefined,
    }),
    [q, lifecycle, unreadOnly, controlMode, escalatedOnly],
  );

  const countsQuery = useQuery({
    queryKey: ["lead-counts"],
    queryFn: () => getLeadDashboardCountsFn(),
  });

  const listQuery = useQuery({
    queryKey: ["leads", filters],
    queryFn: () => listLeadsFn({ data: filters }),
  });

  const threadQuery = useQuery({
    queryKey: ["lead-thread", selectedLeadId],
    queryFn: () => getLeadThreadFn({ data: { leadId: selectedLeadId! } }),
    enabled: Boolean(selectedLeadId),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      sendManualMessageFn({
        data: {
          leadId: selectedLeadId!,
          threadId: threadQuery.data!.thread!.id,
          body: composer,
        },
      }),
    onSuccess: async () => {
      setComposer("");
      await qc.invalidateQueries({ queryKey: ["lead-thread", selectedLeadId] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["lead-counts"] });
    },
  });

  const modeMutation = useMutation({
    mutationFn: (mode: "auto" | "human") =>
      setThreadControlModeFn({
        data: { threadId: threadQuery.data!.thread!.id, mode },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead-thread", selectedLeadId] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: (next: (typeof LEAD_LIFECYCLES)[number]) =>
      updateLeadFn({ data: { leadId: selectedLeadId!, lifecycle: next } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead-thread", selectedLeadId] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["lead-counts"] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startConversationFn({
        data: {
          phone: newPhone,
          body: newBody,
          consentConfirmed: true,
        },
      }),
    onSuccess: async (res) => {
      setShowNew(false);
      setNewPhone("");
      setNewBody("");
      setSelectedLeadId(res.leadId);
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["lead-counts"] });
    },
  });

  const counts = countsQuery.data;
  const items = listQuery.data?.items ?? [];
  const detail = threadQuery.data;

  return (
    <Shell>
      <PageHeader
        kicker="Operate"
        title="Lead Inbox"
        description="Private RingCentral SMS inbox. Routine replies send automatically; human control is for takeovers and escalations only."
        actions={
          <div className="flex gap-2">
            <Link
              to="/integration-health"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
            >
              Integration health
            </Link>
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              New conversation
            </button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="New" value={counts?.New ?? "—"} />
        <Stat label="Unread" value={counts?.Unread ?? "—"} />
        <Stat label="Contacted" value={counts?.Contacted ?? "—"} />
        <Stat label="Qualified" value={counts?.Qualified ?? "—"} />
        <Stat label="Appt scheduled" value={counts?.["Appointment Scheduled"] ?? "—"} />
        <Stat label="Escalated" value={counts?.Escalated ?? "—"} />
      </div>

      {showNew && (
        <Panel title="New conversation" className="mb-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Only for consented leads. Confirms opt-in evidence as owner-confirmed.
          </p>
          <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="+17085551212"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="First outbound message"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={startMutation.isPending || !newPhone || !newBody}
              onClick={() => startMutation.mutate()}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Send
            </button>
          </div>
          {startMutation.isError && (
            <p className="mt-2 text-xs text-destructive">{(startMutation.error as Error).message}</p>
          )}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Panel title="Threads" meta={`${items.length} shown`}>
          <div className="mb-3 space-y-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={lifecycle}
                onChange={(e) => setLifecycle(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value="">All lifecycles</option>
                {LEAD_LIFECYCLES.map((lc) => (
                  <option key={lc} value={lc}>
                    {lc}
                  </option>
                ))}
              </select>
              <select
                value={controlMode}
                onChange={(e) => setControlMode(e.target.value as "" | "auto" | "human")}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Auto + human</option>
                <option value="auto">Auto reply</option>
                <option value="human">Human control</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                Unread
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={escalatedOnly}
                  onChange={(e) => setEscalatedOnly(e.target.checked)}
                />
                Escalated
              </label>
            </div>
          </div>

          {listQuery.isLoading ? (
            <EmptyState label="Loading leads…" />
          ) : items.length === 0 ? (
            <EmptyState label="No leads yet." hint="Inbound SMS will appear here after webhook setup." />
          ) : (
            <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
              {items.map((lead) => {
                const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model]
                  .filter((v) => v != null && v !== "")
                  .join(" ");
                return (
                  <li key={lead.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        selectedLeadId === lead.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-transparent hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {display(lead.name)}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {display(lead.phone_e164)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {vehicle || "Vehicle not entered"}
                          </div>
                        </div>
                        <div className="text-right">
                          {lead.unread_count > 0 && (
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                              {lead.unread_count}
                            </span>
                          )}
                          <div className="mt-1">
                            <Tag tone="info">{lead.lifecycle}</Tag>
                          </div>
                          <div className="mt-1">
                            <Tag tone={lead.controlMode === "human" ? "warning" : "success"}>
                              {lead.controlMode === "human" ? "Human" : "Auto"}
                            </Tag>
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>{display(lead.lead_source)}</span>
                        <span>
                          {lead.last_message_at
                            ? new Date(lead.last_message_at).toLocaleString()
                            : "Not entered"}
                        </span>
                      </div>
                      {lead.hasOpenEscalation && (
                        <div className="mt-1">
                          <Tag tone="danger">Escalated</Tag>
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          {!selectedLeadId ? (
            <EmptyState label="Select a thread" hint="Choose a lead to read the full conversation." />
          ) : threadQuery.isLoading || !detail ? (
            <EmptyState label="Loading thread…" />
          ) : (
            <>
              <Panel
                title={display(detail.lead.name)}
                meta={
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="info">{detail.lead.lifecycle}</Tag>
                    <Tag tone={detail.thread?.control_mode === "human" ? "warning" : "success"}>
                      {detail.thread?.control_mode === "human" ? "Human control" : "Auto reply on"}
                    </Tag>
                  </div>
                }
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    disabled={!detail.thread || modeMutation.isPending}
                    onClick={() =>
                      modeMutation.mutate(detail.thread?.control_mode === "human" ? "auto" : "human")
                    }
                  >
                    Switch to {detail.thread?.control_mode === "human" ? "auto reply" : "human control"}
                  </button>
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                    value={detail.lead.lifecycle}
                    onChange={(e) =>
                      lifecycleMutation.mutate(e.target.value as (typeof LEAD_LIFECYCLES)[number])
                    }
                  >
                    {LEAD_LIFECYCLES.map((lc) => (
                      <option key={lc} value={lc}>
                        {lc}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1fr_16rem]">
                  <div>
                    <div className="mb-3 max-h-[50vh] space-y-2 overflow-y-auto rounded-md border border-border p-3">
                      {(detail.messages ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No messages yet.</p>
                      ) : (
                        detail.messages.map((m) => (
                          <div
                            key={m.id}
                            className={`rounded-md px-3 py-2 text-sm ${
                              m.direction === "outbound"
                                ? "ml-8 bg-primary/10"
                                : "mr-8 bg-secondary"
                            }`}
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="uppercase">{m.direction}</span>
                              <span>{m.channel}</span>
                              <span>{m.delivery_state}</span>
                              <span>
                                {new Date(m.provider_created_at ?? m.created_at).toLocaleString()}
                              </span>
                              {m.attachment_urls != null && <Tag tone="info">MMS/att</Tag>}
                              {m.error_code && <Tag tone="danger">{m.error_code}</Tag>}
                            </div>
                            <p className="whitespace-pre-wrap text-foreground">
                              {m.body ?? "Not entered"}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex gap-2">
                      <textarea
                        value={composer}
                        onChange={(e) => setComposer(e.target.value)}
                        rows={3}
                        placeholder="Manual reply…"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        disabled={
                          !composer.trim() ||
                          !detail.thread ||
                          sendMutation.isPending ||
                          detail.lead.consent_status === "opted_out"
                        }
                        onClick={() => sendMutation.mutate()}
                        className="self-end rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                    {detail.lead.consent_status === "opted_out" && (
                      <p className="mt-2 text-xs text-destructive">
                        Lead opted out — outbound SMS blocked.
                      </p>
                    )}
                    {sendMutation.isError && (
                      <p className="mt-2 text-xs text-destructive">
                        {(sendMutation.error as Error).message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="label-caps mb-1">Contact</div>
                      <Field label="Phone" value={display(detail.lead.phone_e164)} />
                      <Field label="Email" value={display(detail.lead.email)} />
                      <Field label="Consent" value={detail.lead.consent_status} />
                      <Field label="Source" value={display(detail.lead.lead_source)} />
                    </div>
                    <div>
                      <div className="label-caps mb-1">Vehicle</div>
                      <Field label="Year" value={display(detail.lead.vehicle_year)} />
                      <Field label="Make" value={display(detail.lead.vehicle_make)} />
                      <Field label="Model" value={display(detail.lead.vehicle_model)} />
                      <Field label="Mileage" value={display(detail.lead.vehicle_mileage)} />
                      <Field label="VIN" value={display(detail.lead.vin)} />
                    </div>
                    <div>
                      <div className="label-caps mb-1">Notes</div>
                      <p className="text-xs text-muted-foreground">
                        {display(detail.lead.symptoms)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{display(detail.lead.notes)}</p>
                    </div>
                    <div>
                      <div className="label-caps mb-1">Lifecycle history</div>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                        {(detail.events ?? []).length === 0 ? (
                          <li>Not entered</li>
                        ) : (
                          detail.events.map((e) => (
                            <li key={e.id}>
                              {new Date(e.created_at).toLocaleString()} · {e.event_type}
                              {e.from_lifecycle && e.to_lifecycle
                                ? ` (${e.from_lifecycle} → ${e.to_lifecycle})`
                                : ""}
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              </Panel>

              {(detail.escalations ?? []).some((e) => e.status === "open") && (
                <Panel title="Open escalations">
                  <ul className="space-y-2">
                    {detail.escalations
                      .filter((e) => e.status === "open")
                      .map((e) => (
                        <li key={e.id} className="rounded-md border border-border px-3 py-2 text-sm">
                          <Tag tone="danger">{e.category}</Tag>
                          <p className="mt-1 text-foreground">{e.reason}</p>
                          <Link to="/escalations" className="mt-2 inline-block text-xs text-primary">
                            Manage escalations
                          </Link>
                        </li>
                      ))}
                  </ul>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
