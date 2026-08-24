import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel } from "@/components/ops/Shell";
import { ClaimTag, Tag } from "@/components/ops/Bits";
import {
  ACTIVE_EXPERIMENT_POSTURE,
  ARCHITECTURE,
  COMMERCIAL_PRIORITIES,
  FROZEN_CHANGES,
  HISTORY,
  IDENTITY,
  NAP_FACTS,
  SPECULATIVE_CLAIMS,
  UNRESOLVED_QUESTIONS,
  type ContextFact,
} from "@/data/context";

export const Route = createFileRoute("/_authenticated/context")({
  head: () => ({
    meta: [
      { title: "Context Lock — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Canonical Boltz Automotive business record: NAP, hours, services, history, architecture, commercial priorities and frozen changes.",
      },
      { property: "og:title", content: "Context Lock — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Human-readable context lock for Boltz Automotive Inc.",
      },
    ],
  }),
  component: ContextPage,
});

function FactList({ facts }: { facts: ContextFact[] }) {
  return (
    <dl className="divide-y divide-border/60">
      {facts.map((f) => (
        <div key={f.label} className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="label-caps sm:pt-0.5">{f.label}</dt>
          <dd className="flex flex-wrap items-start gap-2 text-sm text-foreground">
            <span className="min-w-0 flex-1">{f.value}</span>
            <ClaimTag value={f.claim} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ContextPage() {
  return (
    <Shell>
      <PageHeader
        kicker="Permanent record"
        title="Context Lock"
        description="Authoritative Boltz business context. Every module, prompt and finding must be consistent with this page. Nothing here may be invented or embellished."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Canonical NAP & hours" meta="Owner-confirmed">
          <FactList facts={NAP_FACTS} />
        </Panel>
        <Panel title="Business identity & services">
          <FactList facts={IDENTITY} />
        </Panel>
        <Panel title="History / legacy">
          <FactList facts={HISTORY} />
        </Panel>
        <Panel title="Website architecture">
          <FactList facts={ARCHITECTURE} />
        </Panel>
        <Panel title="Commercial priorities & capacity posture">
          <FactList facts={COMMERCIAL_PRIORITIES} />
        </Panel>
        <Panel title="Active experiment posture">
          <ul className="space-y-2 text-sm text-foreground">
            {ACTIVE_EXPERIMENT_POSTURE.map((l) => (
              <li key={l} className="flex gap-2">
                <span className="text-primary">·</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Frozen changes — do not perform" meta="Guardrails">
          <ul className="space-y-1.5 text-sm">
            {FROZEN_CHANGES.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <Tag tone="danger">FROZEN</Tag>
                <span className="min-w-0 flex-1 text-foreground">{l}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Treated as hypothesis, never fact">
          <ul className="space-y-1.5 text-sm">
            {SPECULATIVE_CLAIMS.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <Tag tone="warning">HYPOTHESIS</Tag>
                <span className="min-w-0 flex-1 text-foreground">{l}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Never ask customers to insert predetermined keywords into reviews.
          </p>
        </Panel>
        <Panel title="Unresolved questions" className="xl:col-span-2">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {UNRESOLVED_QUESTIONS.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <Tag tone="unknown">OPEN</Tag>
                <span className="min-w-0 flex-1">{l}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
