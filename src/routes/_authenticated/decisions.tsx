import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import {
  ClaimTag,
  DeployTag,
  LevelTag,
  StatusTag,
  Tag,
  TableWrap,
  Th,
  Td,
  Value,
} from "@/components/ops/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useDataSet, nextId, exportJson } from "@/lib/store";
import {
  opportunityScore,
  type DecisionRecord,
  type DecisionStatus,
  type DeploymentState,
  type Impact,
} from "@/data/types";

export const Route = createFileRoute("/_authenticated/decisions")({
  head: () => ({
    meta: [
      { title: "Decision Queue — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Prioritized opportunity backlog: findings, proposed interventions, approvals, deployment batches and measured outcomes.",
      },
      { property: "og:title", content: "Decision Queue — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Findings become interventions only through explicit approval.",
      },
    ],
  }),
  component: DecisionsPage,
});

const STATUSES: DecisionStatus[] = [
  "RESEARCH NOW",
  "PREPARE NOW",
  "READY FOR REVIEW",
  "APPROVED",
  "DEPLOYED",
  "HOLD FOR EXPERIMENT",
  "REJECTED",
];

const DEPLOY_FOR_STATUS: Record<DecisionStatus, DeploymentState> = {
  "RESEARCH NOW": "RESEARCH ONLY",
  "PREPARE NOW": "PREPARED",
  "READY FOR REVIEW": "PREPARED",
  APPROVED: "APPROVED",
  DEPLOYED: "DEPLOYED",
  "HOLD FOR EXPERIMENT": "HELD",
  REJECTED: "REJECTED",
};

const LEVELS: Impact[] = ["HIGH", "MEDIUM", "LOW"];

function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <label className="block">
      {label && <span className="label-caps mb-1 block">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-md border border-input bg-surface-2 px-2 py-1.5 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function DecisionsPage() {
  const { data, update } = useDataSet();
  const [filter, setFilter] = useState<DecisionStatus | "ALL">("ALL");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    finding: "",
    source: "",
    category: "GEO / AI",
    proposedAction: "",
  });

  const rows = useMemo(() => {
    const list =
      filter === "ALL" ? data.decisions : data.decisions.filter((d) => d.status === filter);
    return [...list].sort((a, b) => opportunityScore(b).score - opportunityScore(a).score);
  }, [data.decisions, filter]);

  const patch = (id: string, changes: Partial<DecisionRecord>) =>
    update(
      "decisions",
      data.decisions.map((d) => (d.id === id ? { ...d, ...changes } : d)),
    );

  const setStatus = (d: DecisionRecord, status: DecisionStatus) =>
    patch(d.id, {
      status,
      deploymentState: DEPLOY_FOR_STATUS[status],
      approved: status === "APPROVED" || status === "DEPLOYED" ? true : d.approved,
      deploymentDate:
        status === "DEPLOYED" ? (d.deploymentDate ?? new Date().toISOString().slice(0, 10)) : d.deploymentDate,
    });

  const addFinding = () => {
    if (!draft.finding.trim()) return;
    const record: DecisionRecord = {
      id: nextId("D", data.decisions),
      finding: draft.finding.trim(),
      date: new Date().toISOString().slice(0, 10),
      source: draft.source.trim() || "Manual entry",
      category: draft.category,
      claimClass: "OBSERVED",
      seoImpact: "MEDIUM",
      geoImpact: "MEDIUM",
      engineJobRelevance: "MEDIUM",
      commercialValue: "MEDIUM",
      confidence: "MEDIUM",
      effort: "MEDIUM",
      timeToSignal: null,
      contaminationRisk: "MEDIUM",
      reversible: null,
      proposedAction: draft.proposedAction.trim() || "Not entered",
      status: "RESEARCH NOW",
      approved: null,
      deploymentBatch: null,
      deploymentDate: null,
      measurementDate: null,
      outcome: null,
      deploymentState: "RESEARCH ONLY",
    };
    update("decisions", [...data.decisions, record]);
    setDraft({ finding: "", source: "", category: draft.category, proposedAction: "" });
    setOpen(false);
  };

  return (
    <Shell>
      <PageHeader
        kicker="Findings → interventions"
        title="Decision Queue"
        description="A finding is not an intervention. Nothing here reaches production without an explicit approval and a registered experiment."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportJson("decisions", data.decisions)}>
              Export JSON
            </Button>
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Add finding"}
            </Button>
          </>
        }
      />

      {open && (
        <Panel title="New finding" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="label-caps">Finding</Label>
              <Textarea
                value={draft.finding}
                onChange={(e) => setDraft({ ...draft, finding: e.target.value })}
                placeholder="What was observed, and where?"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="label-caps">Source</Label>
              <Input
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                placeholder="Module, export, or observation"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="label-caps">Category</Label>
              <Input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="label-caps">Proposed action (not a deployment)</Label>
              <Textarea
                value={draft.proposedAction}
                onChange={(e) => setDraft({ ...draft, proposedAction: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={addFinding}>
              Save as RESEARCH NOW
            </Button>
          </div>
        </Panel>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["ALL", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded border px-2 py-1 font-mono text-[10px] tracking-wide uppercase transition-colors ${
              filter === s
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState label="No findings in this state." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Finding / proposed action</Th>
              <Th>Scoring factors</Th>
              <Th>Score</Th>
              <Th>Risk</Th>
              <Th>Status</Th>
              <Th>Lifecycle</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const s = opportunityScore(d);
              return (
                <tr key={d.id} className="hover:bg-surface-2/60">
                  <Td className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {d.id}
                    <div className="mt-1">{d.date}</div>
                  </Td>
                  <Td className="max-w-sm">
                    <div className="text-sm text-foreground">{d.finding}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{d.proposedAction}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <ClaimTag value={d.claimClass} />
                      <Tag>{d.category}</Tag>
                      <Tag tone="unknown">src: {d.source}</Tag>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <LevelTag value={d.seoImpact} label="SEO" />
                      <LevelTag value={d.geoImpact} label="GEO" />
                      <LevelTag value={d.engineJobRelevance} label="Engine" />
                      <LevelTag value={d.commercialValue} label="Value" />
                      <LevelTag value={d.confidence} label="Conf" />
                      <LevelTag value={d.effort} label="Effort" />
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      ({s.factors.seoGeo} × {s.factors.commercial} × {s.factors.engine} ×{" "}
                      {s.factors.confidence}) ÷ {s.factors.effort}
                    </div>
                  </Td>
                  <Td className="font-mono text-lg text-primary">{s.score}</Td>
                  <Td className="space-y-1">
                    <div>
                      <span className="label-caps">Contamination </span>
                      <LevelTag value={d.contaminationRisk} />
                    </div>
                    <div className="text-xs">
                      <span className="label-caps">Reversible </span>
                      <Value value={d.reversible} />
                    </div>
                    <div className="text-xs">
                      <span className="label-caps">Signal </span>
                      <Value value={d.timeToSignal} />
                    </div>
                  </Td>
                  <Td className="min-w-[11rem] space-y-1.5">
                    <StatusTag value={d.status} />
                    <DeployTag value={d.deploymentState} />
                    <Select
                      value={d.status}
                      options={STATUSES}
                      onChange={(v) => setStatus(d, v)}
                    />
                  </Td>
                  <Td className="space-y-1 text-xs">
                    <div>
                      <span className="label-caps">Batch </span>
                      <Value value={d.deploymentBatch} />
                    </div>
                    <div>
                      <span className="label-caps">Deployed </span>
                      <Value value={d.deploymentDate} />
                    </div>
                    <div>
                      <span className="label-caps">Measure </span>
                      <Value value={d.measurementDate} />
                    </div>
                    <div>
                      <span className="label-caps">Outcome </span>
                      <Value value={d.outcome} />
                    </div>
                    <Input
                      placeholder="Record outcome"
                      defaultValue={d.outcome ?? ""}
                      onBlur={(e) =>
                        patch(d.id, {
                          outcome: e.target.value.trim() || null,
                          measurementDate:
                            e.target.value.trim() && !d.measurementDate
                              ? new Date().toISOString().slice(0, 10)
                              : d.measurementDate,
                        })
                      }
                      className="h-7 text-xs"
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Scoring: (SEO/GEO opportunity × commercial value × engine-job value × confidence) ÷ effort.
        Levels map HIGH=3, MEDIUM=2, LOW=1; confidence maps 1 / 0.66 / 0.33. All factors stay
        visible above — nothing is hidden in a black box.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Effort level {LEVELS.join(" / ")} is a divisor: higher effort lowers the score.
      </p>
    </Shell>
  );
}
