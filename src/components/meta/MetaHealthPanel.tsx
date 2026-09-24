import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Panel } from "@/components/ops/Shell";
import { Tag, TableWrap, Td, Th } from "@/components/ops/Bits";
import {
  getMetaHealthFn,
  importMetaLead,
  reconcileMetaNow,
  subscribeMetaPage,
} from "@/lib/meta-leads.functions";

function fmt(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="label-caps w-44 shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** Meta Lead Ads section of /integration-health. Owner-only (integrations.manage). */
export function MetaHealthPanel() {
  const queryClient = useQueryClient();
  const healthFn = useServerFn(getMetaHealthFn);
  const reconcileFn = useServerFn(reconcileMetaNow);
  const importFn = useServerFn(importMetaLead);
  const subscribeFn = useServerFn(subscribeMetaPage);
  const [leadgenId, setLeadgenId] = useState("");

  const health = useQuery({ queryKey: ["meta-health"], queryFn: () => healthFn() });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["meta-health"] });

  const reconcile = useMutation({
    mutationFn: (window: "incremental" | "nightly") => reconcileFn({ data: { window } }),
    onSuccess: refresh,
  });
  const manualImport = useMutation({
    mutationFn: () => importFn({ data: { leadgenId } }),
    onSuccess: (result) => {
      if (result.ok) setLeadgenId("");
      refresh();
    },
  });
  const subscribe = useMutation({ mutationFn: () => subscribeFn(), onSuccess: refresh });

  const data = health.data;

  return (
    <Panel
      title="Meta Lead Ads (Facebook / Instagram)"
      meta={
        <button onClick={refresh} className="rounded border border-border px-2 py-1 text-[10px]">
          {health.isFetching ? "Checking…" : "Re-check"}
        </button>
      }
    >
      {health.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking Meta…</p>
      ) : health.isError || !data ? (
        <p className="text-sm text-destructive">Meta health unavailable.</p>
      ) : (
        <div className="space-y-4">
          {data.configError && <p className="text-xs text-destructive">{data.configError}</p>}

          <div className="grid gap-2 sm:grid-cols-2">
            {data.secrets.map((secret) => (
              <div
                key={secret.name}
                className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs"
              >
                <span className="font-mono">{secret.name}</span>
                <span className="flex items-center gap-2">
                  {secret.masked && <span className="text-muted-foreground">{secret.masked}</span>}
                  <Tag
                    tone={secret.configured ? "success" : secret.optional ? "neutral" : "danger"}
                  >
                    {secret.configured ? "Configured" : secret.optional ? "Default" : "Missing"}
                  </Tag>
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Row label="Webhook">
              <Tag tone={data.webhook.configured ? "success" : "danger"}>
                {data.webhook.configured ? "Configured" : "Not configured"}
              </Tag>
              {data.webhook.callbackUrl && (
                <span className="font-mono text-xs text-muted-foreground">
                  {data.webhook.callbackUrl}
                </span>
              )}
            </Row>
            <Row label="Last webhook">
              <span className="text-xs">{fmt(data.webhook.lastWebhookAt)}</span>
              {data.webhook.lastSignatureFailureAt && (
                <span className="text-xs text-destructive">
                  last bad signature {fmt(data.webhook.lastSignatureFailureAt)}
                </span>
              )}
            </Row>
            <Row label="Page subscription">
              <Tag
                tone={
                  data.subscription.status === "subscribed"
                    ? "success"
                    : data.subscription.status === "not_subscribed"
                      ? "danger"
                      : "warning"
                }
              >
                {data.subscription.status}
              </Tag>
              <span className="text-xs text-muted-foreground">{data.subscription.detail}</span>
              {data.subscription.status !== "subscribed" && !data.configError && (
                <button
                  onClick={() => subscribe.mutate()}
                  className="rounded border border-border px-2 py-1 text-xs"
                >
                  {subscribe.isPending ? "Subscribing…" : "Subscribe Page to leadgen"}
                </button>
              )}
              {subscribe.data && !subscribe.data.ok && (
                <span className="text-xs text-destructive">{subscribe.data.error}</span>
              )}
            </Row>
            <Row label="Token">
              <Tag
                tone={
                  data.token.status === "valid" && data.token.missingScopes.length === 0
                    ? "success"
                    : data.token.status === "unknown"
                      ? "warning"
                      : "danger"
                }
              >
                {data.token.status}
              </Tag>
              <span className="text-xs text-muted-foreground">
                {data.token.type ?? ""} · expires{" "}
                {data.token.expiresAt ? fmt(data.token.expiresAt) : "never"} · {data.token.detail}
              </span>
              {data.token.lastAuthFailureAt && (
                <span className="text-xs text-destructive">
                  last auth failure {fmt(data.token.lastAuthFailureAt)}
                </span>
              )}
            </Row>
            <Row label="Last Graph fetch">
              <span className="text-xs">{fmt(data.graph.lastSuccessAt)}</span>
              {data.graph.lastFailureAt && (
                <span className="text-xs text-destructive">
                  last failure {fmt(data.graph.lastFailureAt)} — {data.graph.lastFailureDetail}
                </span>
              )}
            </Row>
            <Row label="Last reconciliation">
              <span className="text-xs">
                incremental {fmt(data.reconciliation.lastIncremental?.at)}
                {data.reconciliation.lastIncremental?.detail
                  ? ` — ${data.reconciliation.lastIncremental.detail}`
                  : ""}
              </span>
            </Row>
            <Row label="">
              <span className="text-xs">
                nightly {fmt(data.reconciliation.lastNightly?.at)}
                {data.reconciliation.lastNightly?.detail
                  ? ` — ${data.reconciliation.lastNightly.detail}`
                  : ""}
              </span>
            </Row>
            <Row label="Missing leads">
              <Tag tone={data.counts.notIngested > 0 ? "danger" : "success"}>
                {data.counts.notIngested} not ingested
              </Tag>
              <span className="text-xs text-muted-foreground">
                {data.reconciliation.missingAtLastRun} found missing at last reconciliation
              </span>
            </Row>
            <Row label="Last Meta lead">
              {data.lastLead ? (
                <span className="text-xs">
                  {fmt(data.lastLead.created_time)} · {data.lastLead.platform ?? "?"} ·{" "}
                  {data.lastLead.ingestion_method} · {data.lastLead.ingest_status}
                  {data.lastLead.form_name ? ` · ${data.lastLead.form_name}` : ""}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">None yet</span>
              )}
            </Row>
            <Row label="Totals">
              <span className="text-xs text-muted-foreground">
                {data.counts.total} total · webhook {data.counts.byMethod.WEBHOOK} · reconciliation{" "}
                {data.counts.byMethod.RECONCILIATION} · manual {data.counts.byMethod.MANUAL_IMPORT}
              </span>
            </Row>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => reconcile.mutate("incremental")}
              disabled={reconcile.isPending || Boolean(data.configError)}
              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
            >
              {reconcile.isPending ? "Reconciling…" : "Reconcile now (2h)"}
            </button>
            <button
              onClick={() => reconcile.mutate("nightly")}
              disabled={reconcile.isPending || Boolean(data.configError)}
              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
            >
              Reconcile 7 days
            </button>
            <input
              value={leadgenId}
              onChange={(e) => setLeadgenId(e.target.value)}
              placeholder="Meta lead ID"
              className="w-44 rounded border border-border bg-input px-2 py-1 font-mono text-xs"
            />
            <button
              onClick={() => manualImport.mutate()}
              disabled={
                manualImport.isPending || leadgenId.trim().length === 0 || Boolean(data.configError)
              }
              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
            >
              {manualImport.isPending ? "Importing…" : "Manual import"}
            </button>
            {reconcile.data && (
              <span
                className={
                  reconcile.data.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"
                }
              >
                {reconcile.data.ok && reconcile.data.summary
                  ? `scanned ${reconcile.data.summary.scanned}, missing ${reconcile.data.summary.missingDetected + reconcile.data.summary.notIngested}, ingested ${reconcile.data.summary.ingested}, duplicates ${reconcile.data.summary.duplicates}`
                  : reconcile.data.error}
              </span>
            )}
            {manualImport.data && (
              <span
                className={
                  manualImport.data.ok
                    ? "text-xs text-muted-foreground"
                    : "text-xs text-destructive"
                }
              >
                {manualImport.data.ok
                  ? `Import: ${manualImport.data.outcome?.status}`
                  : manualImport.data.error}
              </span>
            )}
          </div>

          {data.recent.length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Meta lead</Th>
                  <Th>Platform</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th>Form / campaign</Th>
                  <Th>Created</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-mono text-xs">{row.meta_lead_id}</Td>
                    <Td className="text-xs">{row.platform ?? "—"}</Td>
                    <Td className="font-mono text-xs">{row.ingestion_method}</Td>
                    <Td>
                      <Tag
                        tone={
                          row.ingest_status === "ingested"
                            ? "success"
                            : row.ingest_status === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {row.ingest_status}
                      </Tag>
                    </Td>
                    <Td className="max-w-xs truncate text-xs">
                      {[row.form_name, row.campaign_name].filter(Boolean).join(" · ") || "—"}
                    </Td>
                    <Td className="text-xs">{fmt(row.created_time)}</Td>
                    <Td className="max-w-xs text-xs text-destructive">{row.last_error ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}
    </Panel>
  );
}
