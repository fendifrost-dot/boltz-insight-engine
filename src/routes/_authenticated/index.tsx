import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { Stat, StatusTag, Tag, Value, TableWrap, Th, Td } from "@/components/ops/Bits";
import { useDataSet } from "@/lib/store";
import { opportunityScore } from "@/data/types";
import { BUSINESS, ACTIVE_EXPERIMENT_POSTURE } from "@/data/context";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Active experiments, next measurement dates, priority opportunities and engine-replacement growth indicators for Boltz Automotive.",
      },
      { property: "og:title", content: "Dashboard — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Internal SEO/GEO operations dashboard for Boltz Automotive Inc.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useDataSet();
  const active = data.experiments.filter((e) =>
    ["RUNNING", "MEASURING", "BASELINE", "PREPARED"].includes(e.status),
  );
  const pendingApproval = data.decisions.filter((d) => d.status === "READY FOR REVIEW");
  const top = [...data.decisions]
    .filter((d) => !["DEPLOYED", "REJECTED"].includes(d.status))
    .sort((a, b) => opportunityScore(b).score - opportunityScore(a).score)
    .slice(0, 6);
  const engineFunnel = data.measurements.filter((m) => m.kind === "funnel");
  const checkpoints = data.experiments
    .flatMap((e) => e.checkpointDates.map((d) => ({ id: e.id, date: d })))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  return (
    <Shell>
      <PageHeader
        kicker="Boltz Automotive Inc. · Internal"
        title="Operations Dashboard"
        description={`Research and decision system for ${BUSINESS.website}. No values are invented — unmeasured fields read "Not entered".`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active experiments" value={active.length} hint="Registry entries in flight" />
        <Stat label="Pending approvals" value={pendingApproval.length} hint="Awaiting owner review" />
        <Stat label="Open findings" value={top.length} hint="Prioritized, not deployed" />
        <Stat
          label="Engine job signal"
          value={<span className="font-mono text-base text-unknown italic">Not entered</span>}
          hint="Awaiting first funnel entry"
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Highest-priority opportunities" meta="Opportunity score">
          {top.length === 0 ? (
            <EmptyState label="No findings recorded." />
          ) : (
            <ul className="space-y-2">
              {top.map((d) => {
                const s = opportunityScore(d);
                return (
                  <li key={d.id} className="rounded-md border border-border bg-surface-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-muted-foreground">{d.id}</div>
                        <p className="text-sm text-foreground">{d.finding}</p>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg text-primary">{s.score}</div>
                        <StatusTag value={d.status} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3">
            <Link to="/decisions" className="text-xs text-accent underline underline-offset-4">
              Open Decision Queue →
            </Link>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Active experiments">
            {active.length === 0 ? (
              <EmptyState
                label="No experiments registered in this system yet."
                hint="Existing Boltz experiments must be transcribed with their preserved baselines before they appear here."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {active.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
                    <span className="min-w-0 flex-1">{e.hypothesis}</span>
                    <Tag tone="info">{e.status}</Tag>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Next measurement dates">
            {checkpoints.length === 0 ? (
              <EmptyState label="No checkpoints scheduled." />
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {checkpoints.map((c, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-muted-foreground">{c.id}</span>
                    <span>{c.date}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Method guardrail">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {ACTIVE_EXPERIMENT_POSTURE.map((l) => (
                <li key={l}>· {l}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="label-caps mb-2">Engine-replacement growth funnel</h2>
        <TableWrap>
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th>Period</Th>
              <Th>Value</Th>
              <Th>Unit</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {engineFunnel.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.metric}</Td>
                <Td className="text-xs text-muted-foreground">{m.period}</Td>
                <Td>
                  <Value value={m.value} />
                </Td>
                <Td className="text-xs text-muted-foreground">{m.unit}</Td>
                <Td>
                  <Value value={m.source} />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </Shell>
  );
}
