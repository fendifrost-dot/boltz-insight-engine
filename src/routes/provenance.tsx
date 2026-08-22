import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { ClaimTag, Stat, Tag, TableWrap, Th, Td, Value } from "@/components/ops/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataSet, nextId, exportJson } from "@/lib/store";
import type { ProvenanceRecord, SourceType } from "@/data/types";

export const Route = createFileRoute("/provenance")({
  head: () => ({
    meta: [
      { title: "Source Provenance Ledger — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Classify every retrieval source by ancestry: first-party, independent, syndicated or derivative — so duplicated data is never counted as corroboration.",
      },
      { property: "og:title", content: "Source Provenance Ledger — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Independent corroboration is counted only once per original source.",
      },
    ],
  }),
  component: ProvenancePage,
});

const TYPES: SourceType[] = [
  "directory",
  "review",
  "editorial",
  "database",
  "UGC",
  "AI synthesis",
  "first-party",
  "social",
  "other",
];

const emptyDraft = {
  url: "",
  sourceType: "directory" as SourceType,
  firstParty: "unknown",
  independent: "unknown",
  syndicated: "unknown",
  derivative: "unknown",
  originalSource: "",
  businessControlled: "unknown",
  entities: "",
};

const tri = (v: string) => (v === "unknown" ? null : v === "yes");

function ProvenancePage() {
  const { data, update } = useDataSet();
  const [draft, setDraft] = useState(emptyDraft);

  const independent = data.provenance.filter(
    (p) => p.independent === true && p.syndicated !== true && p.derivative !== true,
  );
  const originals = new Set(
    data.provenance.map((p) => p.originalSource ?? p.domain).filter(Boolean),
  );

  const add = () => {
    if (!draft.url.trim()) return;
    let domain = draft.url.trim();
    try {
      domain = new URL(draft.url.trim()).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw value */
    }
    const rec: ProvenanceRecord = {
      id: nextId("SRC", data.provenance),
      url: draft.url.trim(),
      domain,
      sourceType: draft.sourceType,
      firstParty: tri(draft.firstParty),
      independent: tri(draft.independent),
      syndicated: tri(draft.syndicated),
      derivative: tri(draft.derivative),
      originalSource: draft.originalSource.trim() || null,
      businessControlled: tri(draft.businessControlled),
      entitiesMentioned: draft.entities
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      queriesSurfacedFor: [],
      platformsSurfacedOn: [],
      claimClass: "OBSERVED",
      notes: "",
    };
    update("provenance", [...data.provenance, rec]);
    setDraft(emptyDraft);
  };

  return (
    <Shell>
      <PageHeader
        kicker="Critical"
        title="Source Provenance Ledger"
        description="Duplicated or syndicated information is never counted as independent corroboration. Ancestry is recorded before any authority conclusion is drawn."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportJson("provenance", data.provenance)}
          >
            Export JSON
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Sources logged" value={data.provenance.length} />
        <Stat
          label="Independent corroboration"
          value={independent.length}
          hint="Non-syndicated, non-derivative"
        />
        <Stat label="Distinct originals" value={originals.size} hint="After ancestry collapse" />
      </div>

      <Panel title="Log source" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="label-caps">URL</Label>
            <Input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="label-caps">Source type</Label>
            <select
              value={draft.sourceType}
              onChange={(e) => setDraft({ ...draft, sourceType: e.target.value as SourceType })}
              className="mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {(
            [
              ["firstParty", "First-party?"],
              ["independent", "Independent?"],
              ["syndicated", "Syndicated?"],
              ["derivative", "Derivative?"],
              ["businessControlled", "Business controlled?"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label className="label-caps">{label}</Label>
              <select
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm"
              >
                <option value="unknown">Not entered</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          ))}
          <div>
            <Label className="label-caps">Original source</Label>
            <Input
              value={draft.originalSource}
              onChange={(e) => setDraft({ ...draft, originalSource: e.target.value })}
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="label-caps">Entities mentioned (comma separated)</Label>
            <Input
              value={draft.entities}
              onChange={(e) => setDraft({ ...draft, entities: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={add}>
            Add source
          </Button>
        </div>
      </Panel>

      {data.provenance.length === 0 ? (
        <EmptyState
          label="Ledger empty."
          hint="Populate from URLs cited or retrieved during AI visibility runs."
        />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Domain / URL</Th>
              <Th>Type</Th>
              <Th>First-party</Th>
              <Th>Independent</Th>
              <Th>Syndicated</Th>
              <Th>Derivative</Th>
              <Th>Original</Th>
              <Th>Controlled</Th>
              <Th>Entities</Th>
              <Th>Claim</Th>
            </tr>
          </thead>
          <tbody>
            {data.provenance.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-xs text-muted-foreground">{p.id}</Td>
                <Td className="max-w-[16rem]">
                  <div className="font-medium">{p.domain}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.url}</div>
                </Td>
                <Td>
                  <Tag>{p.sourceType}</Tag>
                </Td>
                <Td>
                  <Value value={p.firstParty} />
                </Td>
                <Td>
                  <Value value={p.independent} />
                </Td>
                <Td>
                  <Value value={p.syndicated} />
                </Td>
                <Td>
                  <Value value={p.derivative} />
                </Td>
                <Td>
                  <Value value={p.originalSource} />
                </Td>
                <Td>
                  <Value value={p.businessControlled} />
                </Td>
                <Td className="text-xs">
                  {p.entitiesMentioned.length ? p.entitiesMentioned.join(", ") : <Value value={null} />}
                </Td>
                <Td>
                  <ClaimTag value={p.claimClass} />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Shell>
  );
}
