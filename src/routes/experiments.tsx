import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel, EmptyState } from "@/components/ops/Shell";
import { Tag, Value } from "@/components/ops/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useDataSet, nextId, exportJson } from "@/lib/store";
import type { ExperimentRecord } from "@/data/types";

export const Route = createFileRoute("/experiments")({
  head: () => ({
    meta: [
      { title: "Experiment Registry — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Immutable registry of Boltz SEO/GEO experiments: hypothesis, baseline, intervention, controls, confounders, checkpoints and criteria.",
      },
      { property: "og:title", content: "Experiment Registry — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Baselines preserved, interventions isolated, outcomes measured.",
      },
    ],
  }),
  component: ExperimentsPage,
});

const STATUSES: ExperimentRecord["status"][] = [
  "BASELINE",
  "PREPARED",
  "RUNNING",
  "MEASURING",
  "CONCLUDED",
  "ABANDONED",
];

const emptyDraft = {
  hypothesis: "",
  intervention: "",
  baselineDate: "",
  surfaces: "",
  controls: "",
  confounders: "",
  holdList: "",
  checkpoints: "",
  success: "",
  failure: "",
};

function list(v: string) {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ExperimentsPage() {
  const { data, update } = useDataSet();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const create = () => {
    if (!draft.hypothesis.trim()) return;
    const rec: ExperimentRecord = {
      id: nextId("EXP", data.experiments),
      hypothesis: draft.hypothesis.trim(),
      baselineDate: draft.baselineDate || null,
      deploymentDate: null,
      intervention: draft.intervention.trim() || "Not entered",
      surfacesAffected: list(draft.surfaces),
      controlVariables: list(draft.controls),
      confounders: list(draft.confounders),
      holdList: list(draft.holdList),
      checkpointDates: list(draft.checkpoints),
      successCriteria: draft.success.trim() || "Not entered",
      failureCriteria: draft.failure.trim() || "Not entered",
      status: "BASELINE",
      immutable: false,
    };
    update("experiments", [...data.experiments, rec]);
    setDraft(emptyDraft);
    setOpen(false);
  };

  const patch = (id: string, changes: Partial<ExperimentRecord>) =>
    update(
      "experiments",
      data.experiments.map((e) => (e.id === id ? { ...e, ...changes } : e)),
    );

  return (
    <Shell>
      <PageHeader
        kicker="Controlled interventions"
        title="Experiment Registry"
        description="One intervention per experiment. Concluded experiments are locked so history stays immutable."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportJson("experiments", data.experiments)}
            >
              Export JSON
            </Button>
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Register experiment"}
            </Button>
          </>
        }
      />

      {open && (
        <Panel title="New experiment" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="label-caps">Hypothesis</Label>
              <Textarea
                value={draft.hypothesis}
                onChange={(e) => setDraft({ ...draft, hypothesis: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="label-caps">Intervention (single change)</Label>
              <Textarea
                value={draft.intervention}
                onChange={(e) => setDraft({ ...draft, intervention: e.target.value })}
                className="mt-1"
              />
            </div>
            {(
              [
                ["baselineDate", "Baseline date (YYYY-MM-DD)"],
                ["surfaces", "Surfaces affected (comma separated)"],
                ["controls", "Control variables"],
                ["confounders", "Known confounders"],
                ["holdList", "Hold list (changes frozen during run)"],
                ["checkpoints", "Checkpoint dates"],
                ["success", "Success criteria"],
                ["failure", "Failure criteria"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label className="label-caps">{label}</Label>
                <Input
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={create}>
              Register at BASELINE
            </Button>
          </div>
        </Panel>
      )}

      {data.experiments.length === 0 ? (
        <EmptyState
          label="No experiments registered."
          hint="Boltz already runs controlled experiments; transcribe them here with their preserved baseline dates before deploying anything new."
        />
      ) : (
        <div className="space-y-4">
          {data.experiments.map((e) => (
            <Panel
              key={e.id}
              title={`${e.id} · ${e.hypothesis}`}
              meta={e.immutable ? "LOCKED" : e.status}
            >
              <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <Field label="Intervention" value={e.intervention} />
                <Field label="Baseline date" value={e.baselineDate} />
                <Field label="Deployment date" value={e.deploymentDate} />
                <ListField label="Surfaces affected" values={e.surfacesAffected} />
                <ListField label="Control variables" values={e.controlVariables} />
                <ListField label="Confounders" values={e.confounders} />
                <ListField label="Hold list" values={e.holdList} tone="danger" />
                <ListField label="Checkpoints" values={e.checkpointDates} tone="info" />
                <Field label="Success criteria" value={e.successCriteria} />
                <Field label="Failure criteria" value={e.failureCriteria} />
              </div>
              {!e.immutable && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={e.status}
                    onChange={(ev) =>
                      patch(e.id, {
                        status: ev.target.value as ExperimentRecord["status"],
                        deploymentDate:
                          ev.target.value === "RUNNING" && !e.deploymentDate
                            ? new Date().toISOString().slice(0, 10)
                            : e.deploymentDate,
                      })
                    }
                    className="rounded-md border border-input bg-surface-2 px-2 py-1.5 font-mono text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patch(e.id, { immutable: true, status: "CONCLUDED" })}
                  >
                    Conclude & lock
                  </Button>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </Shell>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="label-caps">{label}</div>
      <Value value={value} />
    </div>
  );
}

function ListField({
  label,
  values,
  tone = "neutral",
}: {
  label: string;
  values: string[];
  tone?: "neutral" | "danger" | "info";
}) {
  return (
    <div>
      <div className="label-caps">{label}</div>
      {values.length === 0 ? (
        <Value value={null} />
      ) : (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {values.map((v) => (
            <Tag key={v} tone={tone}>
              {v}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
