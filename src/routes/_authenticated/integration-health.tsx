import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { Tag } from "@/components/ops/Bits";
import {
  createRingCentralSubscriptionFn,
  getIntegrationHealthFn,
  retryFailedJobFn,
} from "@/server/functions/lead-inbox";

export const Route = createFileRoute("/_authenticated/integration-health")({
  head: () => ({
    meta: [{ title: "Integration Health — Boltz Ops" }],
  }),
  component: IntegrationHealthPage,
});

function IntegrationHealthPage() {
  const qc = useQueryClient();
  const health = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => getIntegrationHealthFn(),
    refetchInterval: 60_000,
  });

  const createSub = useMutation({
    mutationFn: () => createRingCentralSubscriptionFn(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["integration-health"] });
    },
  });

  const retryJob = useMutation({
    mutationFn: (jobId: string) => retryFailedJobFn({ data: { jobId } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["integration-health"] });
    },
  });

  const data = health.data;

  return (
    <Shell>
      <PageHeader
        kicker="Operate"
        title="Integration health"
        description="RingCentral and Grok status. Secrets show Configured/Missing only — never values."
        actions={
          <Link to="/leads" className="rounded-md border border-border px-3 py-1.5 text-xs">
            Lead Inbox
          </Link>
        }
      />

      {health.isLoading || !data ? (
        <EmptyState label="Loading health…" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="RingCentral">
            <dl className="space-y-2 text-sm">
              <Row label="Secrets" value={data.ringcentral.secrets} />
              <Row label="Connection" value={data.ringcentral.connection} />
              <Row label="Server URL" value={data.ringcentral.serverUrl ?? "Not entered"} />
              <Row label="From number" value={data.ringcentral.fromNumberMasked ?? "Not entered"} />
              <Row label="Extension" value={data.ringcentral.extensionId ?? "Not entered"} />
              <Row label="SMS capability" value={data.ringcentral.smsCapability ?? "Not entered"} />
              <Row label="Webhook path" value={data.ringcentral.webhookPath} />
              <Row label="Public app URL" value={data.ringcentral.publicAppUrl ?? "Not entered"} />
              <Row label="Last inbound" value={data.ringcentral.lastInboundAt ?? "Not entered"} />
              {data.ringcentral.error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {data.ringcentral.error}
                </div>
              )}
              {data.ringcentral.missing.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Missing: {data.ringcentral.missing.join(", ")}
                </div>
              )}
            </dl>
            <div className="mt-4">
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                disabled={createSub.isPending || data.ringcentral.secrets !== "Configured"}
                onClick={() => createSub.mutate()}
              >
                Create / refresh SMS webhook subscription
              </button>
              {createSub.isError && (
                <p className="mt-2 text-xs text-destructive">{(createSub.error as Error).message}</p>
              )}
              {createSub.isSuccess && (
                <p className="mt-2 text-xs text-success">
                  Subscription {createSub.data.subscriptionId} · capability{" "}
                  {createSub.data.smsCapability}
                </p>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <div className="label-caps">Subscriptions</div>
              {(data.ringcentral.subscriptions ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">None recorded</p>
              ) : (
                data.ringcentral.subscriptions.map((s) => (
                  <div key={s.id} className="rounded-md border border-border px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <Tag tone="info">{s.status}</Tag>
                      <span className="font-mono">{s.id}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Expires: {s.expiresAt ?? "Not entered"}
                    </div>
                    <div className="text-muted-foreground">
                      Last inbound event: {s.lastNotificationAt ?? "Not entered"}
                    </div>
                    {s.lastRenewalError && (
                      <div className="mt-1 text-destructive">Renewal error: {s.lastRenewalError}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Grok / xAI">
            <dl className="space-y-2 text-sm">
              <Row label="Secrets" value={data.grok.secrets} />
              <Row label="Model" value={data.grok.model ?? "Not entered"} />
              {data.grok.missing.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Missing: {data.grok.missing.join(", ")}
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Routine replies send automatically. There is no draft approval queue.
            </p>
          </Panel>

          <Panel title="Recent job errors (redacted)" className="lg:col-span-2">
            {(data.jobs.recentErrors ?? []).length === 0 ? (
              <EmptyState label="No recent errors." />
            ) : (
              <ul className="space-y-2">
                {data.jobs.recentErrors.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <div>
                      <Tag tone="warning">{j.status}</Tag>{" "}
                      <span className="font-mono">{j.jobType}</span>
                      <div className="mt-1 text-muted-foreground">{j.lastError}</div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1"
                      onClick={() => retryJob.mutate(j.id)}
                    >
                      Retry
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}
