import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, PageHeader, Shell } from "@/components/ops/Shell";
import { listDeskLeads } from "@/lib/desk.functions";
import { displayPhone } from "@/lib/lead-inbox-thread-sync";

export const Route = createFileRoute("/_authenticated/desk/")({
  head: () => ({
    meta: [
      { title: "Shop desk · Boltz" },
      {
        name: "description",
        content: "Record walk-in and phone leads at the Boltz Automotive counter.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DeskHome,
});

function DeskHome() {
  const listFn = useServerFn(listDeskLeads);
  const recent = useQuery({
    queryKey: ["desk-leads", ""],
    queryFn: () => listFn({ data: {} }),
  });
  const rows = (recent.data ?? []).slice(0, 5);

  return (
    <Shell>
      <PageHeader
        kicker="Counter"
        title="Shop desk"
        description="Log a walk-in or a phone call in a few taps. The lead lands in the same list as online leads."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/desk/new"
          search={{ channel: "walk_in" }}
          className="flex min-h-28 items-center justify-center rounded-lg border-2 border-primary bg-primary px-4 text-center text-xl font-semibold text-primary-foreground"
        >
          New walk-in
        </Link>
        <Link
          to="/desk/new"
          search={{ channel: "phone" }}
          className="flex min-h-28 items-center justify-center rounded-lg border-2 border-border bg-card px-4 text-center text-xl font-semibold text-foreground"
        >
          New phone lead
        </Link>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-sm font-semibold">Recent leads</h2>
          <Link to="/desk/leads" className="text-sm font-medium text-primary">
            Search all
          </Link>
        </div>
        {recent.isError ? (
          <EmptyState label="Could not load leads" hint="Check the connection and try again." />
        ) : rows.length === 0 ? (
          <EmptyState label="No leads yet" hint="A walk-in or phone call will show up here." />
        ) : (
          <ul className="space-y-2">
            {rows.map((lead) => (
              <li key={lead.id}>
                <Link
                  to="/desk/leads/$leadId"
                  params={{ leadId: lead.id }}
                  className="block min-h-16 rounded-md border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-medium">{lead.name || "No name"}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {lead.lifecycle}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {displayPhone(lead.phone)}
                    {lead.leadSource ? ` · ${lead.leadSource}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
