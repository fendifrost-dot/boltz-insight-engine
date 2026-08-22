import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { ClaimTag, Tag, Value } from "@/components/ops/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataSet, nextId, exportJson } from "@/lib/store";
import type { Competitor } from "@/data/types";

export const Route = createFileRoute("/competitors")({
  head: () => ({
    meta: [
      { title: "Competitor Dossiers — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Evolving competitor dossiers covering categories, reviews, engine pages, financing, warranty language, backlinks, citations and AI visibility.",
      },
      { property: "og:title", content: "Competitor Dossiers — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Observation only. Competitor findings never become direct production changes.",
      },
    ],
  }),
  component: CompetitorsPage,
});

const FIELDS: [keyof Competitor, string][] = [
  ["website", "Website"],
  ["gbp", "GBP listing"],
  ["location", "Location"],
  ["primaryCategory", "Primary category"],
  ["reviewCount", "Review count"],
  ["reviewVelocity", "Review velocity"],
  ["enginePages", "Engine pages"],
  ["engineCostPages", "Engine cost pages"],
  ["financing", "Financing"],
  ["warrantyLanguage", "Warranty language"],
  ["backlinks", "Backlinks"],
  ["citations", "Citations"],
  ["aiVisibility", "AI visibility"],
];

function CompetitorsPage() {
  const { data, update } = useDataSet();
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    const rec: Competitor = {
      id: nextId("C", data.competitors),
      name: name.trim(),
      website: null,
      gbp: null,
      location: null,
      primaryCategory: null,
      secondaryCategories: [],
      reviewCount: null,
      reviewVelocity: null,
      services: [],
      enginePages: null,
      engineCostPages: null,
      financing: null,
      warrantyLanguage: null,
      backlinks: null,
      citations: null,
      aiVisibility: null,
      retrievalSources: [],
      claimClass: "UNKNOWN",
      notes: "",
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    update("competitors", [...data.competitors, rec]);
    setName("");
  };

  const patch = (id: string, changes: Partial<Competitor>) =>
    update(
      "competitors",
      data.competitors.map((c) =>
        c.id === id ? { ...c, ...changes, updatedAt: new Date().toISOString().slice(0, 10) } : c,
      ),
    );

  return (
    <Shell>
      <PageHeader
        kicker="Observation"
        title="Competitor Dossiers"
        description="Dossiers evolve over time. Nothing observed here is copied automatically — findings must pass through the Decision Queue."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportJson("competitors", data.competitors)}
          >
            Export JSON
          </Button>
        }
      />

      <Panel title="Add competitor" className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Label className="label-caps">Business name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shop name (no data invented)"
              className="mt-1"
            />
          </div>
          <Button size="sm" onClick={add}>
            Create dossier
          </Button>
        </div>
      </Panel>

      {data.competitors.length === 0 ? (
        <EmptyState
          label="No competitor dossiers yet."
          hint="Nothing was seeded — competitor rankings, review counts and AI results must be observed, not assumed."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.competitors.map((c) => (
            <Panel key={c.id} title={c.name} meta={`Updated ${c.updatedAt ?? "—"}`}>
              <div className="mb-2 flex flex-wrap gap-1">
                <ClaimTag value={c.claimClass} />
                <Tag tone="unknown">{c.id}</Tag>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {FIELDS.map(([key, label]) => (
                  <div key={String(key)}>
                    <div className="label-caps">{label}</div>
                    <Value value={c[key] as string | number | null} />
                    <Input
                      defaultValue={(c[key] as string | number | null) ?? ""}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const numeric = ["reviewCount", "enginePages", "engineCostPages", "backlinks", "citations"].includes(
                          String(key),
                        );
                        patch(c.id, {
                          [key]: raw === "" ? null : numeric ? Number(raw) : raw,
                          claimClass: c.claimClass === "UNKNOWN" ? "OBSERVED" : c.claimClass,
                        } as Partial<Competitor>);
                      }}
                      className="mt-1 h-7 text-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <div className="label-caps">Notes</div>
                <Input
                  defaultValue={c.notes}
                  onBlur={(e) => patch(c.id, { notes: e.target.value })}
                  className="mt-1 h-7 text-xs"
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </Shell>
  );
}
