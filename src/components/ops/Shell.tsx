import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";


const NAV: { to: string; label: string; group: string }[] = [
  { to: "/", label: "Dashboard", group: "Operate" },
  { to: "/context", label: "Context Lock", group: "Operate" },
  { to: "/decisions", label: "Decision Queue", group: "Operate" },
  { to: "/experiments", label: "Experiment Registry", group: "Operate" },
  { to: "/measurement", label: "Measurement", group: "Operate" },
  { to: "/leads", label: "Lead Inbox", group: "Leads" },
  { to: "/appointments", label: "Appointments", group: "Leads" },
  { to: "/escalations", label: "Escalations", group: "Leads" },
  { to: "/integration-health", label: "Integration Health", group: "Leads" },
  { to: "/ads", label: "Google Ads", group: "Research" },
  { to: "/queries", label: "Query Universe", group: "Research" },
  { to: "/ai-visibility", label: "AI Visibility", group: "Research" },
  { to: "/local-seo", label: "Google / Local SEO", group: "Research" },
  { to: "/competitors", label: "Competitor Dossiers", group: "Research" },
  { to: "/provenance", label: "Source Provenance", group: "Research" },
  { to: "/modules", label: "Audit Modules", group: "Research" },
];

const GROUPS = ["Operate", "Leads", "Research"];

export function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="px-4 py-4">

          <div className="font-mono text-xs tracking-[0.18em] text-primary">BOLTZ</div>
          <div className="text-sm font-semibold text-sidebar-foreground">SEO / GEO Ops</div>
          <div className="label-caps mt-1">Internal tooling · V1</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 whitespace-nowrap lg:block lg:space-y-4 lg:overflow-x-visible lg:whitespace-normal">
          {GROUPS.map((group) => (
            <div key={group} className="flex gap-1 lg:block lg:space-y-0.5">
              <div className="label-caps hidden px-2 pt-2 pb-1 lg:block">{group}</div>
              {NAV.filter((n) => n.group === group).map((item) => (

                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  className="block rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  activeProps={{
                    className:
                      "bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-sidebar-primary",
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="px-4 py-3">
          <button
            onClick={signOut}
            className="w-full rounded-md border border-sidebar-border px-2 py-1.5 text-xs text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            Sign out
          </button>
        </div>
        <div className="hidden px-4 pb-4 text-[11px] leading-relaxed text-muted-foreground lg:block">
          Public site stays on Durable. No production changes ship from here.
        </div>

      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  kicker,
  description,
  actions,
}: {
  title: string;
  kicker?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0">
        {kicker && <div className="label-caps mb-1">{kicker}</div>}
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  meta,
  children,
  className,
}: {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
