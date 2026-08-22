import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel } from "@/components/ops/Shell";
import { Tag, Value } from "@/components/ops/Bits";
import { useDataSet } from "@/lib/store";
import type { AuditModule } from "@/data/types";

export const Route = createFileRoute("/modules")({
  head: () => ({
    meta: [
      { title: "Audit Modules — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Reusable Local SEO, Website SEO, GEO/AI and Authority audit modules. Modules generate findings, never automatic fixes.",
      },
      { property: "og:title", content: "Audit Modules — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Repeatable research modules feeding the Decision Queue.",
      },
    ],
  }),
  component: ModulesPage,
});

const FAMILIES: AuditModule["family"][] = [
  "Local SEO",
  "Website SEO",
  "GEO / AI",
  "Authority",
];

function ModulesPage() {
  const { data } = useDataSet();

  return (
    <Shell>
      <PageHeader
        kicker="Repeatable research"
        title="Audit Module Index"
        description="Each module produces findings that enter the Decision Queue. No module deploys a change."
      />

      <div className="space-y-4">
        {FAMILIES.map((family) => (
          <Panel
            key={family}
            title={family}
            meta={`${data.modules.filter((m) => m.family === family).length} modules`}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.modules
                .filter((m) => m.family === family)
                .map((m) => (
                  <div key={m.id} className="rounded-md border border-border bg-surface-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold">{m.name}</h3>
                      <Tag tone="unknown">{m.id}</Tag>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.purpose}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.inputs.map((i) => (
                        <Tag key={i} tone="info">
                          {i}
                        </Tag>
                      ))}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="label-caps">Last run</span>
                      <Value value={m.lastRun} />
                    </div>
                  </div>
                ))}
            </div>
          </Panel>
        ))}
      </div>
    </Shell>
  );
}
