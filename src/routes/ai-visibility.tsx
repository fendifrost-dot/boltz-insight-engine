import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { Tag, TableWrap, Th, Td, Value } from "@/components/ops/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataSet, nextId, exportJson } from "@/lib/store";
import { PLATFORMS, type AiVisibilityRecord, type Platform } from "@/data/types";

export const Route = createFileRoute("/ai-visibility")({
  head: () => ({
    meta: [
      { title: "AI Visibility — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Per-platform AI visibility tracking: direct mentions, recommendation rank, retrieved sources, citations, competitors and factual accuracy.",
      },
      { property: "og:title", content: "AI Visibility — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Platforms are tracked separately — never blended into one score.",
      },
    ],
  }),
  component: AiVisibilityPage,
});

const emptyDraft = {
  query: "",
  platform: "ChatGPT" as Platform,
  date: new Date().toISOString().slice(0, 10),
  directMention: "unknown",
  recommendationRank: "",
  presentInRetrievedSource: "unknown",
  sourceUrl: "",
  sourceInternalRank: "",
  boltzSiteCited: "unknown",
  competitors: "",
  serviceAssociation: "",
  engineAssociation: "unknown",
};

const tri = (v: string) => (v === "unknown" ? null : v === "yes");
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function AiVisibilityPage() {
  const { data, update } = useDataSet();
  const [platform, setPlatform] = useState<Platform | "ALL">("ALL");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const rows = data.aiVisibility.filter((r) => platform === "ALL" || r.platform === platform);

  const perPlatform = PLATFORMS.map((p) => {
    const runs = data.aiVisibility.filter((r) => r.platform === p);
    const measured = runs.filter((r) => r.directMention !== null);
    const mentions = measured.filter((r) => r.directMention).length;
    const sourcePresent = runs.filter((r) => r.presentInRetrievedSource === true);
    const sourceToMention = sourcePresent.filter((r) => r.directMention === true).length;
    return {
      platform: p,
      runs: runs.length,
      mentionRate: measured.length ? Math.round((mentions / measured.length) * 100) : null,
      sourcePresence: sourcePresent.length,
      conversion: sourcePresent.length
        ? Math.round((sourceToMention / sourcePresent.length) * 100)
        : null,
    };
  });

  const add = () => {
    if (!draft.query.trim()) return;
    const rec: AiVisibilityRecord = {
      id: nextId("AIV", data.aiVisibility),
      queryId: data.queries.find((q) => q.query === draft.query.trim())?.id ?? null,
      query: draft.query.trim(),
      platform: draft.platform,
      date: draft.date,
      directMention: tri(draft.directMention),
      recommendationRank: num(draft.recommendationRank),
      presentInRetrievedSource: tri(draft.presentInRetrievedSource),
      sourceUrl: draft.sourceUrl.trim() || null,
      sourceInternalRank: num(draft.sourceInternalRank),
      boltzSiteCited: tri(draft.boltzSiteCited),
      competitors: draft.competitors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      factualAccuracy: null,
      serviceAssociation: draft.serviceAssociation.trim() || null,
      engineAssociation: tri(draft.engineAssociation),
    };
    update("aiVisibility", [...data.aiVisibility, rec]);
    setDraft({ ...emptyDraft, platform: draft.platform });
    setOpen(false);
  };

  return (
    <Shell>
      <PageHeader
        kicker="GEO measurement"
        title="AI Visibility"
        description="One row per query × platform × date. Results are never blended across platforms."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportJson("ai-visibility", data.aiVisibility)}
            >
              Export JSON
            </Button>
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Log test result"}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {perPlatform.map((p) => (
          <div key={p.platform} className="panel px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{p.platform}</span>
              <Tag tone={p.runs ? "info" : "unknown"}>{p.runs} runs</Tag>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="label-caps">Mention</div>
                <Value value={p.mentionRate} suffix={p.mentionRate === null ? "" : "%"} />
              </div>
              <div>
                <div className="label-caps">Src present</div>
                <Value value={p.runs ? p.sourcePresence : null} />
              </div>
              <div>
                <div className="label-caps">Src→mention</div>
                <Value value={p.conversion} suffix={p.conversion === null ? "" : "%"} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <Panel title="Log AI visibility test" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label className="label-caps">Query</Label>
              <Input
                list="query-universe"
                value={draft.query}
                onChange={(e) => setDraft({ ...draft, query: e.target.value })}
                className="mt-1"
              />
              <datalist id="query-universe">
                {data.queries.map((q) => (
                  <option key={q.id} value={q.query} />
                ))}
              </datalist>
            </div>
            <div>
              <Label className="label-caps">Platform</Label>
              <select
                value={draft.platform}
                onChange={(e) => setDraft({ ...draft, platform: e.target.value as Platform })}
                className="mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="label-caps">Date</Label>
              <Input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="mt-1"
              />
            </div>
            {(
              [
                ["directMention", "Direct Boltz mention"],
                ["presentInRetrievedSource", "Present in retrieved source"],
                ["boltzSiteCited", "Boltz site cited"],
                ["engineAssociation", "Engine-replacement association"],
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
                  <option value="no">No (measured)</option>
                </select>
              </div>
            ))}
            <div>
              <Label className="label-caps">Recommendation rank</Label>
              <Input
                value={draft.recommendationRank}
                onChange={(e) => setDraft({ ...draft, recommendationRank: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="label-caps">Source-internal rank</Label>
              <Input
                value={draft.sourceInternalRank}
                onChange={(e) => setDraft({ ...draft, sourceInternalRank: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="label-caps">Source URL</Label>
              <Input
                value={draft.sourceUrl}
                onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="label-caps">Competitors named (comma separated)</Label>
              <Input
                value={draft.competitors}
                onChange={(e) => setDraft({ ...draft, competitors: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="label-caps">Service association</Label>
              <Input
                value={draft.serviceAssociation}
                onChange={(e) => setDraft({ ...draft, serviceAssociation: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={add}>
              Save run
            </Button>
          </div>
        </Panel>
      )}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {(["ALL", ...PLATFORMS] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`rounded border px-2 py-1 font-mono text-[10px] uppercase ${
              platform === p
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          label="No AI visibility runs recorded."
          hint="Run the AI Visibility Panel module against the engine clusters to create the first baseline."
        />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Query</Th>
              <Th>Platform</Th>
              <Th>Mention</Th>
              <Th>Rank</Th>
              <Th>In source</Th>
              <Th>Source URL</Th>
              <Th>Cited</Th>
              <Th>Engine assoc.</Th>
              <Th>Competitors</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.date}</Td>
                <Td>{r.query}</Td>
                <Td>
                  <Tag tone="info">{r.platform}</Tag>
                </Td>
                <Td>
                  <Value value={r.directMention} />
                </Td>
                <Td>
                  <Value value={r.recommendationRank} />
                </Td>
                <Td>
                  <Value value={r.presentInRetrievedSource} />
                </Td>
                <Td className="max-w-[16rem] truncate text-xs">
                  <Value value={r.sourceUrl} />
                </Td>
                <Td>
                  <Value value={r.boltzSiteCited} />
                </Td>
                <Td>
                  <Value value={r.engineAssociation} />
                </Td>
                <Td className="text-xs">
                  {r.competitors.length ? r.competitors.join(", ") : <Value value={null} />}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Shell>
  );
}
