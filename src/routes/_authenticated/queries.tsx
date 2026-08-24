import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader } from "@/components/ops/Shell";
import { LevelTag, Tag, TableWrap, Th, Td, Value } from "@/components/ops/Bits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDataSet, exportJson } from "@/lib/store";
import { CLUSTER_WEIGHT, QUERY_CLUSTERS } from "@/data/types";

export const Route = createFileRoute("/_authenticated/queries")({
  head: () => ({
    meta: [
      { title: "Query Universe — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Query records by cluster, intent, commercial priority and engine relevance, with baseline and current visibility tracked separately.",
      },
      { property: "og:title", content: "Query Universe — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Engine clusters carry the highest commercial weighting.",
      },
    ],
  }),
  component: QueriesPage,
});

function QueriesPage() {
  const { data, update } = useDataSet();
  const [cluster, setCluster] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const rows = data.queries
    .filter((q) => (cluster === "ALL" ? true : q.cluster === cluster))
    .filter((q) => q.query.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => CLUSTER_WEIGHT[b.cluster] - CLUSTER_WEIGHT[a.cluster]);

  const patch = (id: string, changes: Partial<(typeof data.queries)[number]>) =>
    update(
      "queries",
      data.queries.map((q) => (q.id === id ? { ...q, ...changes } : q)),
    );

  return (
    <Shell>
      <PageHeader
        kicker="Research targets"
        title="Query Universe"
        description="Queries are weighted by cluster. Engine-related clusters carry the highest commercial weight; visibility is never assumed."
        actions={
          <Button variant="outline" size="sm" onClick={() => exportJson("queries", data.queries)}>
            Export JSON
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search queries…"
          className="h-8 max-w-xs text-sm"
        />
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className="h-8 rounded-md border border-input bg-surface-2 px-2 font-mono text-xs"
        >
          <option value="ALL">ALL CLUSTERS</option>
          {QUERY_CLUSTERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="label-caps">{rows.length} records</span>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Query</Th>
            <Th>Cluster · weight</Th>
            <Th>Intent</Th>
            <Th>Priority</Th>
            <Th>Engine</Th>
            <Th>Surface</Th>
            <Th>Baseline visibility</Th>
            <Th>Current visibility</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id} className="hover:bg-surface-2/60">
              <Td className="font-mono text-xs text-muted-foreground">{q.id}</Td>
              <Td className="font-medium">{q.query}</Td>
              <Td>
                <Tag tone={CLUSTER_WEIGHT[q.cluster] >= 0.8 ? "primary" : "neutral"}>
                  {q.cluster}
                </Tag>
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  ×{CLUSTER_WEIGHT[q.cluster]}
                </span>
              </Td>
              <Td className="text-xs text-muted-foreground">{q.intent}</Td>
              <Td>
                <LevelTag value={q.commercialPriority} />
              </Td>
              <Td>
                <LevelTag value={q.engineRelevance} />
              </Td>
              <Td className="text-xs text-muted-foreground">{q.platform}</Td>
              <Td>
                <Value value={q.baselineVisibility} />
                <Input
                  defaultValue={q.baselineVisibility ?? ""}
                  onBlur={(e) => patch(q.id, { baselineVisibility: e.target.value.trim() || null })}
                  placeholder="e.g. pos 14 / absent"
                  className="mt-1 h-7 text-xs"
                />
              </Td>
              <Td>
                <Value value={q.currentVisibility} />
                <Input
                  defaultValue={q.currentVisibility ?? ""}
                  onBlur={(e) => patch(q.id, { currentVisibility: e.target.value.trim() || null })}
                  placeholder="e.g. pos 9 / map pack"
                  className="mt-1 h-7 text-xs"
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p className="mt-3 text-xs text-muted-foreground">
        Blank means unknown, not zero. Record "absent" explicitly when a measured run found no
        Boltz presence.
      </p>
    </Shell>
  );
}
