import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { Tag, TableWrap, Td, Th } from "@/components/ops/Bits";
import {
  ensureSubscription,
  getIntegrationHealth,
  resumeAgentFn,
} from "@/lib/lead-inbox.functions";

export const Route = createFileRoute("/_authenticated/integration-health")({
  head: () => ({
    meta: [
      { title: "Integration Health · Boltz SEO/GEO Ops" },
      {
        name: "description",
        content: "RingCentral and Grok connection status, webhook subscriptions, and job queue state.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: HealthPage,
});

function fmt(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Not entered";
}

function HealthPage() {
  const queryClient = useQueryClient();
  const healthFn = useServerFn(getIntegrationHealth);
  const resume = useServerFn(resumeAgentFn);
  const ensure = useServerFn(ensureSubscription);

  const health = useQuery({ queryKey: ["integration-health"], queryFn: () => healthFn({}) });

  const resumeMutation = useMutation({
    mutationFn: () => resume({}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["integration-health"] }),
  });
  const ensureMutation = useMutation({
    mutationFn: () => ensure({}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["integration-health"] }),
  });

  const data = health.data;

  return (
    <Shell>
      <PageHeader
        kicker="Integrations"
        title="Integration Health"
        description="Secret presence, SMS capability, webhook subscription lifetime and job queue state. Secret values are never displayed."
      />

      <div className="space-y-4">
        <Panel title="Secrets" meta="Configured / Missing only">
          {health.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(data?.secrets ?? []).map((secret) => (
                <div
                  key={secret.name}
                  className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs"
                >
                  <span className="font-mono">{secret.name}</span>
                  <span className="flex items-center gap-2">
                    {secret.masked && <span className="text-muted-foreground">{secret.masked}</span>}
                    <Tag tone={secret.configured ? "success" : "danger"}>
                      {secret.configured ? "Configured" : "Missing"}
                    </Tag>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Agent + SMS capability">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps">Agent circuit</span>
              <Tag tone={data?.circuit.paused ? "danger" : "success"}>
                {data?.circuit.paused ? "Paused" : "Active"}
              </Tag>
              {data?.circuit.detail && (
                <span className="text-xs text-muted-foreground">{data.circuit.detail}</span>
              )}
              {data?.circuit.paused && (
                <button
                  onClick={() => resumeMutation.mutate()}
                  className="rounded border border-border px-2 py-1 text-xs"
                >
                  Resume agent
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps">SMS capability</span>
              <Tag tone={data?.capability?.capability === "none" ? "danger" : "info"}>
                {data?.capability?.capability ?? "unknown"}
              </Tag>
              <span className="text-xs text-muted-foreground">{data?.capability?.detail}</span>
            </div>
          </div>
        </Panel>

        <Panel
          title="Webhook subscriptions"
          meta={
            <button
              onClick={() => ensureMutation.mutate()}
              className="rounded border border-border px-2 py-1 text-[10px]"
            >
              {ensureMutation.isPending ? "Working…" : "Create / renew now"}
            </button>
          }
        >
          {(data?.subscriptions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subscription recorded. Use “Create / renew now” once RingCentral secrets and
              PUBLIC_APP_URL are configured on the deployed URL.
            </p>
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Status</Th>
                    <Th>Expires</Th>
                    <Th>Last renewed</Th>
                    <Th>Delivery address</Th>
                    <Th>Error</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.subscriptions.map((sub) => (
                    <tr key={sub.id}>
                      <Td>
                        <Tag tone={sub.status === "Active" ? "success" : "warning"}>{sub.status}</Tag>
                      </Td>
                      <Td className="text-xs">{fmt(sub.expires_at)}</Td>
                      <Td className="text-xs">{fmt(sub.last_renewed_at)}</Td>
                      <Td className="max-w-xs truncate font-mono text-xs">{sub.delivery_address}</Td>
                      <Td className="max-w-xs text-xs text-destructive">
                        {sub.last_renewal_error ?? ""}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {ensureMutation.data && !ensureMutation.data.ok && (
            <p className="mt-2 text-xs text-destructive">{ensureMutation.data.error}</p>
          )}
        </Panel>

        <Panel title="Job queue" meta={`${data?.jobs.length ?? 0} recent`}>
          {(data?.jobs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs recorded.</p>
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Attempts</Th>
                    <Th>Run after</Th>
                    <Th>Last error</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.jobs.map((job) => (
                    <tr key={job.id}>
                      <Td className="font-mono text-xs">{job.job_type}</Td>
                      <Td>
                        <Tag
                          tone={
                            job.status === "succeeded"
                              ? "success"
                              : job.status === "dead" || job.status === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {job.status}
                        </Tag>
                      </Td>
                      <Td className="text-xs">{job.attempts}</Td>
                      <Td className="text-xs">{fmt(job.run_after)}</Td>
                      <Td className="max-w-xs text-xs text-destructive">{job.last_error ?? ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Recent health snapshots">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {(data?.snapshots ?? []).map((snap) => (
              <li key={snap.id}>
                <Tag tone={snap.ok ? "success" : "danger"}>{snap.provider}</Tag>{" "}
                <span className="font-mono">{snap.check_name}</span> · {fmt(snap.created_at)}
                {snap.detail ? ` — ${snap.detail}` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
