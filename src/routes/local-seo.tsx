import { createFileRoute } from "@tanstack/react-router";
import { Shell, PageHeader, Panel } from "@/components/ops/Shell";
import { Tag, Value } from "@/components/ops/Bits";
import { BUSINESS } from "@/data/context";

export const Route = createFileRoute("/local-seo")({
  head: () => ({
    meta: [
      { title: "Google / Local SEO — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Observation areas for Google Business Profile, reviews, posts, photos, Map Pack presence and Search Console data. No automatic GBP changes.",
      },
      { property: "og:title", content: "Google / Local SEO — Boltz SEO/GEO Ops" },
      {
        property: "og:description",
        content: "Observation surfaces only — the GBP is never edited from this system.",
      },
    ],
  }),
  component: LocalSeoPage,
});

const AREAS: { title: string; fields: string[]; note?: string }[] = [
  { title: "GBP observations", fields: ["Listing state", "Verification", "Description"] },
  { title: "Category audit", fields: ["Primary category", "Secondary categories"], note: "Never copy competitor categories automatically." },
  { title: "Attributes", fields: ["Attributes set", "Attributes available"] },
  { title: "Services", fields: ["Engine replacement service item", "Collision/body items", "Financing items"] },
  { title: "Reviews", fields: ["Total count", "Average rating", "Engine-job mentions"] },
  { title: "Review velocity", fields: ["Last 30 days", "Last 90 days", "Trailing 12 months"], note: "Velocity and total count are tracked separately." },
  { title: "Review language themes", fields: ["Dominant themes", "Engine language present"] },
  { title: "GBP posts", fields: ["Post cadence", "Last post date"], note: "Ranking effect is a hypothesis, not a fact." },
  { title: "Photos", fields: ["Photo count", "Coverage by service line"] },
  { title: "Rankings / Map Pack", fields: ["Tracked grid", "Map Pack presence", "Local finder"] },
  { title: "Search Console", fields: ["Access", "Last import", "Date range"], note: "Import later; nothing is assumed today." },
];

function LocalSeoPage() {
  return (
    <Shell>
      <PageHeader
        kicker="Observation surfaces"
        title="Google / Local SEO"
        description="Structured places to record what is observed. This system never edits the Google Business Profile."
      />

      <Panel title="Canonical record used for consistency checks" className="mb-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="label-caps">Name</div>
            {BUSINESS.name}
          </div>
          <div>
            <div className="label-caps">Address</div>
            {BUSINESS.address}
          </div>
          <div>
            <div className="label-caps">Phone</div>
            {BUSINESS.phone}
          </div>
          <div>
            <div className="label-caps">Hours</div>
            {BUSINESS.hours}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((a) => (
          <Panel key={a.title} title={a.title}>
            <dl className="space-y-2">
              {a.fields.map((f) => (
                <div key={f} className="flex items-baseline justify-between gap-3">
                  <dt className="label-caps">{f}</dt>
                  <dd>
                    <Value value={null} />
                  </dd>
                </div>
              ))}
            </dl>
            {a.note && (
              <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <Tag tone="warning">NOTE</Tag>
                <span>{a.note}</span>
              </p>
            )}
          </Panel>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Tag tone="danger">FROZEN</Tag>
        No automatic GBP changes. Any proposed GBP edit must enter the Decision Queue and be
        registered as an isolated experiment before deployment.
      </p>
    </Shell>
  );
}
