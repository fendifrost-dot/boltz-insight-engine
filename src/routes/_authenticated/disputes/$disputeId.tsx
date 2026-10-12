import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { TableWrap, Tag, Td, Th } from "@/components/ops/Bits";
import { getSquareDispute, saveDisputeEvidence } from "@/lib/square.functions";

export const Route = createFileRoute("/_authenticated/disputes/$disputeId")({
  head: () => ({
    meta: [
      { title: "Dispute · Boltz SEO/GEO Ops" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DisputeDetailPage,
});

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmt(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function DisputeDetailPage() {
  const { disputeId } = Route.useParams();
  const detailFn = useServerFn(getSquareDispute);
  const detail = useQuery({
    queryKey: ["square-dispute", disputeId],
    queryFn: () => detailFn({ data: { disputeId } }),
  });
  const dispute = detail.data;

  return (
    <Shell>
      <PageHeader
        kicker="Payments"
        title={dispute ? usd(dispute.amountCents) : "Dispute"}
        description="Internal evidence checklist. Saving a row does not submit anything to Square."
        actions={
          <Link to="/disputes" className="text-sm underline">
            All disputes
          </Link>
        }
      />
      <div className="space-y-4">
        {detail.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {detail.isError && (
          <p className="text-sm text-destructive">
            {detail.error instanceof Error ? detail.error.message : "Could not load this dispute"}
          </p>
        )}
        {detail.isSuccess && !dispute && (
          <p className="text-sm text-muted-foreground">This dispute is not stored.</p>
        )}
        {dispute && (
          <>
            {dispute.dueSoon && (
              <Panel title="Deadline">
                <p className="text-sm">
                  Response due {fmt(dispute.dueBy)}. This is inside the 3-day window, or already
                  overdue.
                </p>
              </Panel>
            )}
            <Panel title="Square dispute">
              <div className="flex flex-wrap gap-2">
                <Tag tone={dispute.dueSoon ? "danger" : dispute.needsResponse ? "warning" : "info"}>
                  {dispute.state}
                </Tag>
                <Tag tone="neutral">{dispute.reason}</Tag>
                <Tag tone="neutral">{dispute.matchStatus}</Tag>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="label-caps">Due</dt>
                  <dd>{fmt(dispute.dueBy)}</dd>
                </div>
                <div>
                  <dt className="label-caps">Card</dt>
                  <dd>{[dispute.cardBrand, dispute.cardLast4].filter(Boolean).join(" ") || "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Dispute</dt>
                  <dd className="font-mono text-xs">{dispute.disputeId}</dd>
                </div>
                <div>
                  <dt className="label-caps">Payment</dt>
                  <dd className="font-mono text-xs">{dispute.paymentId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Customer</dt>
                  <dd className="font-mono text-xs">{dispute.customerId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Opened</dt>
                  <dd>{fmt(dispute.createdAt)}</dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Evidence checklist" meta="Status, link, or file">
              <div className="space-y-4">
                {dispute.evidence.map((item) => (
                  <EvidenceRow key={item.kind} disputeId={dispute.disputeId} item={item} />
                ))}
              </div>
            </Panel>

            <Panel title="Already in the app">
              <div className="space-y-3 text-sm">
                <p>
                  Lead:{" "}
                  {dispute.gathered.lead ? (
                    <Link
                      to="/desk/leads/$leadId"
                      params={{ leadId: dispute.gathered.lead.leadId }}
                      className="underline"
                    >
                      {dispute.gathered.lead.lifecycle ?? "linked"} ·{" "}
                      {dispute.gathered.lead.matchStatus}
                    </Link>
                  ) : (
                    "No lead linked yet"
                  )}
                </p>
                {dispute.gathered.threads.length === 0 ? (
                  <p className="text-muted-foreground">No SMS thread on the linked lead.</p>
                ) : (
                  <ul className="space-y-1">
                    {dispute.gathered.threads.map((thread) => (
                      <li key={thread.threadId}>
                        Thread {thread.threadId.slice(0, 8)} · {thread.messageCount} messages · last{" "}
                        {fmt(thread.lastMessageAt)}
                      </li>
                    ))}
                  </ul>
                )}
                {dispute.messages.length > 0 && (
                  <ul className="space-y-2">
                    {dispute.messages.map((message) => (
                      <li key={message.id} className="rounded border border-border px-2 py-1.5">
                        <div className="text-xs text-muted-foreground">
                          {message.direction} · {fmt(message.createdAt)}
                        </div>
                        <p className="whitespace-pre-wrap">{message.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>

            <Panel title="Other payments on this card">
              {dispute.gathered.sameCardPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No other stored payment on this card for the same customer or lead.
                </p>
              ) : (
                <PaymentTable
                  rows={dispute.gathered.sameCardPayments.map((payment) => ({
                    id: payment.squareId,
                    when: payment.createdAt,
                    status: payment.status,
                    amount: payment.amountCents,
                  }))}
                />
              )}
            </Panel>

            <Panel title="Invoices">
              {dispute.gathered.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No stored invoice for this customer or lead.
                </p>
              ) : (
                <PaymentTable
                  rows={dispute.gathered.invoices.map((invoice) => ({
                    id: invoice.invoiceNumber ?? invoice.squareId,
                    when: invoice.createdAt,
                    status: invoice.status,
                    amount: invoice.amountCents,
                  }))}
                />
              )}
            </Panel>
          </>
        )}
      </div>
    </Shell>
  );
}

function PaymentTable({
  rows,
}: {
  rows: { id: string; when: string | null; status: string; amount: number }[];
}) {
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Id</Th>
            <Th>When</Th>
            <Th>Status</Th>
            <Th>Amount</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td className="font-mono text-xs">{row.id}</Td>
              <Td className="text-xs">{fmt(row.when)}</Td>
              <Td className="text-xs">{row.status}</Td>
              <Td className="text-xs">{usd(row.amount)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function EvidenceRow({
  disputeId,
  item,
}: {
  disputeId: string;
  item: {
    kind: string;
    label: string;
    status: "missing" | "ready" | "not_applicable";
    linkUrl: string | null;
    hasFile: boolean;
    fileName: string | null;
    note: string | null;
    signedUrl: string | null;
  };
}) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveDisputeEvidence);
  const [status, setStatus] = useState(item.status);
  const [linkUrl, setLinkUrl] = useState(item.linkUrl ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [clearFile, setClearFile] = useState(false);
  const [file, setFile] = useState<{ name: string; mime: string; base64: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          disputeId,
          kind: item.kind,
          status,
          linkUrl: linkUrl.trim() ? linkUrl.trim() : null,
          note: note.trim() ? note.trim() : null,
          clearFile,
          ...(file ? { file } : {}),
        },
      }),
    onSuccess: (result) => {
      setMessage(result.ok ? "Saved" : result.reason);
      setFile(null);
      setClearFile(false);
      void queryClient.invalidateQueries({ queryKey: ["square-dispute", disputeId] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Save failed");
    },
  });

  return (
    <form
      className="space-y-2 rounded border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{item.label}</h3>
        <Tag
          tone={
            item.status === "ready" ? "success" : item.status === "missing" ? "warning" : "neutral"
          }
        >
          {item.status}
        </Tag>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Status
          <select
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="missing">Missing</option>
            <option value="ready">Ready</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </label>
        <label className="text-xs">
          Link
          <input
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={linkUrl}
            placeholder="https://"
            onChange={(event) => setLinkUrl(event.target.value)}
          />
        </label>
      </div>
      <label className="block text-xs">
        Note
        <textarea
          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label>
          File
          <input
            className="mt-1 block text-sm"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (!picked) {
                setFile(null);
                return;
              }
              if (picked.size > 5 * 1024 * 1024) {
                setMessage("File must be 5 MB or smaller");
                event.target.value = "";
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const result = typeof reader.result === "string" ? reader.result : "";
                const base64 = result.includes(",") ? (result.split(",")[1] ?? "") : result;
                setFile({ name: picked.name, mime: picked.type, base64 });
                setClearFile(false);
              };
              reader.readAsDataURL(picked);
            }}
          />
        </label>
        {item.hasFile && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={clearFile}
              onChange={(event) => setClearFile(event.target.checked)}
            />
            Remove {item.fileName ?? "file"}
          </label>
        )}
        {item.signedUrl && (
          <a className="underline" href={item.signedUrl} target="_blank" rel="noreferrer">
            Open file
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded border border-border px-2 py-1 text-xs"
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </form>
  );
}
