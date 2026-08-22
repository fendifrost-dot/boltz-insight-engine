import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel } from "@/components/ops/Shell";
import { TableWrap, Th, Td, Value, Tag } from "@/components/ops/Bits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDataSet, exportJson } from "@/lib/store";
import type { MetricKind } from "@/data/types";

export const Route = createFileRoute("/measurement")({
  head: () => ({
    meta: [
      { title: "Measurement — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Business-outcome measurement for Boltz: engine inquiry to completed job funnel, plus engagement, search and AI visibility metrics.",
      },
      { property: "og:title", content: "Measurement — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Rankings are inputs; engine jobs and gross profit are the outcome.",
      },
    ],
  }),
  component: MeasurementPage,
});

const GROUPS: { kind: MetricKind; title: string; note: string }[] = [
  {
    kind: "funnel",
    title: "Engine-replacement funnel (priority)",
    note: "inquiry → booked diagnostic → approved job → completed job → revenue → gross profit",
  },
  { kind: "engagement", title: "Engagement & leads", note: "Calls, forms, sessions, AI referrals" },
  { kind: "search", title: "Search visibility", note: "Impressions, clicks, rankings, Map Pack" },
  { kind: "ai", title: "AI visibility", note: "Mentions, source presence, conversion" },
];

function MeasurementPage() {
  const { data, update } = useDataSet();

  const patch = (id: string, changes: Partial<(typeof data.measurements)[number]>) =>
    update(
      "measurements",
      data.measurements.map((m) => (m.id === id ? { ...m, ...changes } : m)),
    );

  return (
    <Shell>
      <PageHeader
        kicker="Outcomes, not vanity"
        title="Measurement"
        description="Unavailable numbers stay empty. A recorded 0 means measured zero; blank means unknown."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportJson("measurements", data.measurements)}
          >
            Export JSON
          </Button>
        }
      />

      <div className="space-y-4">
        {GROUPS.map((g) => (
          <Panel key={g.kind} title={g.title} meta={g.note}>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  <Th>Period</Th>
                  <Th>Value</Th>
                  <Th>Unit</Th>
                  <Th>Source</Th>
                  <Th>Experiment</Th>
                </tr>
              </thead>
              <tbody>
                {data.measurements
                  .filter((m) => m.kind === g.kind)
                  .map((m) => (
                    <tr key={m.id}>
                      <Td className="font-medium">{m.metric}</Td>
                      <Td>
                        <Input
                          defaultValue={m.period}
                          onBlur={(e) => patch(m.id, { period: e.target.value })}
                          className="h-7 w-40 text-xs"
                        />
                      </Td>
                      <Td>
                        <Value value={m.value} />
                        <Input
                          defaultValue={m.value ?? ""}
                          placeholder="blank = unknown"
                          onBlur={(e) =>
                            patch(m.id, {
                              value: e.target.value.trim() === "" ? null : Number(e.target.value),
                            })
                          }
                          className="mt-1 h-7 w-28 text-xs"
                        />
                      </Td>
                      <Td className="text-xs text-muted-foreground">{m.unit}</Td>
                      <Td>
                        <Input
                          defaultValue={m.source ?? ""}
                          placeholder="GSC / manual / CRM"
                          onBlur={(e) => patch(m.id, { source: e.target.value.trim() || null })}
                          className="h-7 w-36 text-xs"
                        />
                      </Td>
                      <Td>
                        <select
                          value={m.experimentId ?? ""}
                          onChange={(e) => patch(m.id, { experimentId: e.target.value || null })}
                          className="h-7 rounded-md border border-input bg-surface-2 px-1.5 font-mono text-[11px]"
                        >
                          <option value="">— none —</option>
                          {data.experiments.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.id}
                            </option>
                          ))}
                        </select>
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </TableWrap>
          </Panel>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Tag tone="warning">RULE</Tag>
        No number is fabricated. Import paths (GSC, GA, GBP exports, CSV, call tracking, job/revenue
        data) can be added later without changing this schema.
      </p>
    </Shell>
  );
}
