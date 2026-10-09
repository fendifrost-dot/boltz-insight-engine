import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ArrowRight } from "lucide-react";
import { DeskShell } from "@/components/desk/DeskShell";
import { CustomerCard } from "@/components/desk/CustomerCard";
import { listDeskLeads } from "@/lib/desk.functions";

export const Route = createFileRoute("/_authenticated/desk/leads/")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 80) : "",
  }),
  head: () => ({
    meta: [{ title: "Find a customer · Boltz" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: DeskLeadList,
});

function DeskLeadList() {
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate();
  const listFn = useServerFn(listDeskLeads);
  const [query, setQuery] = useState(q);
  useEffect(() => setQuery(q), [q]);
  const leads = useQuery({
    queryKey: ["desk-leads", q],
    queryFn: () => listFn({ data: q ? { query: q } : {} }),
  });
  return (
    <DeskShell>
      <header className="desk-page-heading">
        <div className="desk-eyebrow">CUSTOMER BOOK</div>
        <h1>Pick up where we left off.</h1>
        <p>Find anyone who called, walked in, texted, or reached us online.</p>
      </header>
      <form
        className="desk-search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: "/desk/leads", search: { q: query.trim() } });
        }}
      >
        <Search size={21} />
        <input
          aria-label="Search customers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, phone number, vehicle, or where they found us"
          maxLength={80}
        />
        <button type="submit" aria-label="Search">
          <ArrowRight size={20} />
        </button>
      </form>
      <div className="desk-section-heading">
        <h2>{q ? "Search results" : "Recent customers"}</h2>
        {leads.data && (
          <span>
            {leads.data.length === 40
              ? "Showing up to 40 · narrow your search"
              : `${leads.data.length} customer${leads.data.length === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      {leads.isPending ? (
        <div className="desk-empty">Looking up customers…</div>
      ) : leads.isError ? (
        <div className="desk-empty">
          Could not load customers. <button onClick={() => void leads.refetch()}>Try again</button>
        </div>
      ) : !leads.data?.length ? (
        <div className="desk-empty">
          <Search size={24} />
          <div>
            <strong>No customers found.</strong>
            <p>Try a full phone number or part of their name.</p>
          </div>
        </div>
      ) : (
        <div className="desk-card-list">
          {leads.data.map((lead) => (
            <CustomerCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </DeskShell>
  );
}
