import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowRight, CalendarDays, Footprints, Phone, Search } from "lucide-react";
import { DeskShell } from "@/components/desk/DeskShell";
import { CustomerCard } from "@/components/desk/CustomerCard";
import { listDeskLeads } from "@/lib/desk.functions";
import { getShopSchedule } from "@/lib/desk-chat.functions";

export const Route = createFileRoute("/_authenticated/desk/")({
  head: () => ({
    meta: [
      { title: "Front desk · Boltz Automotive" },
      { name: "description", content: "Welcome every walk-in and caller at Boltz Automotive." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DeskHome,
});

function DeskHome() {
  const listFn = useServerFn(listDeskLeads);
  const scheduleFn = useServerFn(getShopSchedule);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const recent = useQuery({ queryKey: ["desk-leads", ""], queryFn: () => listFn({ data: {} }) });
  const schedule = useQuery({
    queryKey: ["shop-schedule"],
    queryFn: () => scheduleFn(),
    refetchInterval: 60_000,
  });
  return (
    <DeskShell>
      <header className="desk-page-heading">
        <div className="desk-eyebrow">THE FRONT DESK</div>
        <h1>Ready for the next customer.</h1>
        <p>Walked in or called in? Get their details down while they’re here.</p>
      </header>
      <div className="desk-intake-actions">
        <Link to="/desk/new" search={{ channel: "walk_in" }} className="desk-intake-action walk-in">
          <span className="desk-action-icon">
            <Footprints size={26} />
          </span>
          <div>
            <span>AT THE COUNTER</span>
            <h2>New walk-in</h2>
            <p>Someone just stopped by.</p>
          </div>
          <ArrowRight size={24} />
        </Link>
        <Link to="/desk/new" search={{ channel: "phone" }} className="desk-intake-action phone">
          <span className="desk-action-icon">
            <Phone size={25} />
          </span>
          <div>
            <span>ON THE LINE</span>
            <h2>New phone lead</h2>
            <p>Turn the call into a customer.</p>
          </div>
          <ArrowRight size={24} />
        </Link>
      </div>
      <form
        className="desk-search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: "/desk/leads", search: { q: query.trim() } });
        }}
      >
        <Search size={21} />
        <input
          aria-label="Find an existing customer"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Already been in touch? Search name or phone"
          maxLength={80}
        />
        <button type="submit" aria-label="Search customers">
          <ArrowRight size={20} />
        </button>
      </form>
      <section className="desk-section">
        <div className="desk-section-heading">
          <h2>
            <CalendarDays size={19} /> Today’s visits
          </h2>
          <span>Chicago time</span>
        </div>
        {schedule.isPending ? (
          <div className="desk-empty">Checking today’s schedule…</div>
        ) : schedule.isError ? (
          <div className="desk-empty">
            The schedule couldn’t load.{" "}
            <button onClick={() => void schedule.refetch()}>Try again</button>
          </div>
        ) : (
          <>
            {!schedule.data.visits.length ? (
              <div className="desk-empty">
                <CalendarDays size={25} />
                <div>
                  <strong>No dated visits on the desk today.</strong>
                  <p>Open a customer to add their confirmed visit.</p>
                </div>
              </div>
            ) : (
              <div className="desk-card-list">
                {schedule.data.visits.slice(0, 5).map((lead) => (
                  <CustomerCard key={lead.id} lead={lead} showVisit />
                ))}
              </div>
            )}
            {schedule.data.visits.length > 5 && (
              <Link to="/desk/chat" className="desk-text-link">
                Ask Grok for all {schedule.data.visits.length}
                {schedule.data.truncated ? "+" : ""} visits
              </Link>
            )}
            {schedule.data.missingDates > 0 && (
              <p className="desk-note">
                {schedule.data.missingDates} customer
                {schedule.data.missingDates === 1 ? " is" : "s are"} marked as booked without a
                date. Those visits aren’t included above.
              </p>
            )}
          </>
        )}
      </section>
      <section className="desk-section">
        <div className="desk-section-heading">
          <h2>Recent customers</h2>
          <Link to="/desk/leads">
            Find a customer <ArrowRight size={15} />
          </Link>
        </div>
        {recent.isPending ? (
          <div className="desk-empty">Loading customers…</div>
        ) : recent.isError ? (
          <div className="desk-empty">
            Customers couldn’t load.{" "}
            <button onClick={() => void recent.refetch()}>Try again</button>
          </div>
        ) : !recent.data?.length ? (
          <div className="desk-empty">Your first walk-in or phone lead will appear here.</div>
        ) : (
          <div className="desk-card-list">
            {recent.data.slice(0, 4).map((lead) => (
              <CustomerCard key={lead.id} lead={lead} />
            ))}
          </div>
        )}
      </section>
    </DeskShell>
  );
}
