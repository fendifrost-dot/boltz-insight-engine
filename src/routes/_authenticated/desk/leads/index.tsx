import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, PageHeader, Shell } from "@/components/ops/Shell";
import { listDeskLeads } from "@/lib/desk.functions";
import { displayPhone } from "@/lib/lead-inbox-thread-sync";

export const Route = createFileRoute("/_authenticated/desk/leads/")({
  head: () => ({
    meta: [{ title: "Leads · Shop desk" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: DeskLeadList,
});

function vehicleLine(lead: {
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
}): string {
  return [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ");
}

function DeskLeadList() {
  const listFn = useServerFn(listDeskLeads);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const leads = useQuery({
    queryKey: ["desk-leads", submitted],
    queryFn: () => listFn({ data: submitted ? { query: submitted } : {} }),
  });
  const rows = leads.data ?? [];

  return (
    <Shell>
      <PageHeader
        kicker="Counter"
        title="Leads"
        description="Search by phone, name, vehicle, or source."
        actions={
          <Link to="/desk" className="text-sm font-medium text-primary">
            Desk home
          </Link>
        }
      />
      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label className="sr-only" htmlFor="desk-search">
          Search leads
        </label>
        <input
          id="desk-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Phone, name, vehicle, source"
          className="min-h-14 w-full rounded-md border border-border bg-input px-3 text-lg"
        />
        <button
          type="submit"
          className="min-h-14 rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground"
        >
          Search
        </button>
      </form>
      {leads.isError ? (
        <EmptyState label="Could not load leads" />
      ) : rows.length === 0 ? (
        <EmptyState label="No matching leads" hint="Try a phone number or part of a name." />
      ) : (
        <ul className="space-y-2">
          {rows.map((lead) => {
            const vehicle = vehicleLine(lead);
            return (
              <li key={lead.id}>
                <Link
                  to="/desk/leads/$leadId"
                  params={{ leadId: lead.id }}
                  className="block min-h-20 rounded-md border border-border bg-card px-4 py-3"
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
                    {lead.intakePath === "desk" ? " · Desk" : ""}
                  </p>
                  {vehicle && <p className="mt-1 text-sm">{vehicle}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
