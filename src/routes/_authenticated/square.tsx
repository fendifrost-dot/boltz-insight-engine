import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { TableWrap, Tag, Td, Th } from "@/components/ops/Bits";
import { getSquareDashboard } from "@/lib/square.functions";

export const Route = createFileRoute("/_authenticated/square")({
  head: () => ({
    meta: [
      { title: "Square · Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Square connection, weekly revenue from completed payments, and payments that are not linked to a lead.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SquarePage,
});

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmt(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function SquarePage() {
  const dashboardFn = useServerFn(getSquareDashboard);
  const dashboard = useQuery({
    queryKey: ["square-dashboard"],
    queryFn: () => dashboardFn(),
  });
  const data = dashboard.data;

  return (
    <Shell>
      <PageHeader
        kicker="Payments"
        title="Square"
        description="Read-only revenue from the shop Square account. Payments link to leads by phone or email. Customer names, phones, and emails are not shown here."
      />
      <div className="space-y-4">
        <Panel title="Connection">
          {dashboard.isLoading && <p className="text-sm text-muted-foreground">Checking…</p>}
          {dashboard.isError && (
            <p className="text-sm text-destructive">
              {dashboard.error instanceof Error ? dashboard.error.message : "Square status failed"}
            </p>
          )}
          {data && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Tag tone={data.configured ? "success" : "warning"}>
                  {data.configured ? (data.environment ?? "connected") : "Not configured"}
                </Tag>
                <Tag tone={data.signatureConfigured ? "success" : "danger"}>
                  {data.signatureConfigured ? "Webhook ready" : "Webhook rejected"}
                </Tag>
                <Tag
                  tone={
                    data.locationMode === "ambiguous" || data.locationMode === "none"
                      ? "warning"
                      : "info"
                  }
                >
                  {data.locationMode}
                </Tag>
              </div>
              {data.reason && <p className="text-sm text-muted-foreground">{data.reason}</p>}
              {data.applicationId && (
                <p className="font-mono text-xs">Application ID {data.applicationId}</p>
              )}
              {data.resolvedLocationId && (
                <p className="font-mono text-xs">Location {data.resolvedLocationId}</p>
              )}
              {data.locationMode === "ambiguous" && (
                <p className="text-sm text-muted-foreground">
                  More than one active location. Sync reads every active location and does not pick
                  one. Set SQUARE_LOCATION_ID to the shop location you want pinned.
                </p>
              )}
              {data.locationMode === "discovered" && (
                <p className="text-sm text-muted-foreground">
                  SQUARE_LOCATION_ID is unset. The only active location is in use.
                </p>
              )}
              {!data.signatureConfigured && (
                <p className="text-sm text-muted-foreground">
                  Webhook events are rejected until SQUARE_WEBHOOK_SIGNATURE_KEY is saved. The
                  notification URL is {data.webhookUrl ?? "unset until PUBLIC_APP_URL is set"}.
                </p>
              )}
              {data.locationError && (
                <p className="text-xs text-destructive">Locations {data.locationError}</p>
              )}
              {data.storageError && (
                <p className="text-xs text-destructive">Storage {data.storageError}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {data.secrets.map((secret) => (
                  <div
                    key={secret.name}
                    className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono">{secret.name}</span>
                    <span className="flex items-center gap-2">
                      {secret.masked && (
                        <span className="text-muted-foreground">{secret.masked}</span>
                      )}
                      <Tag
                        tone={
                          secret.configured ? "success" : secret.optional ? "warning" : "danger"
                        }
                      >
                        {secret.configured ? "Configured" : "Missing"}
                      </Tag>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {data && data.locations.length > 0 && (
          <Panel title="Locations" meta="From List Locations">
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Id</Th>
                    <Th>Status</Th>
                    <Th>Name</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.locations.map((location) => (
                    <tr key={location.id}>
                      <Td className="font-mono text-xs">{location.id}</Td>
                      <Td>
                        <Tag tone={location.status === "ACTIVE" ? "success" : "neutral"}>
                          {location.status}
                        </Tag>
                      </Td>
                      <Td className="text-xs">{location.name ?? ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        )}

        <Panel title="Sync">
          {(data?.sync ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No sync recorded yet.</p>
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Resource</Th>
                    <Th>Count</Th>
                    <Th>Last success</Th>
                    <Th>Error</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.sync.map((row) => (
                    <tr key={row.resource}>
                      <Td className="font-mono text-xs">{row.resource}</Td>
                      <Td className="text-xs">{row.lastCount}</Td>
                      <Td className="text-xs">{fmt(row.lastSuccessAt)}</Td>
                      <Td className="text-xs text-destructive">{row.lastError ?? ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Weekly revenue" meta="America/Chicago, Monday start">
          {(data?.weeks ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed Square payments stored yet.
            </p>
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Week</Th>
                    <Th>Gross</Th>
                    <Th>Refunds</Th>
                    <Th>Net</Th>
                    <Th>Tickets</Th>
                    <Th>Avg</Th>
                    <Th>Attributed</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.weeks.map((week) => (
                    <tr key={week.weekStart}>
                      <Td className="font-mono text-xs">{week.weekStart}</Td>
                      <Td className="text-xs">{usd(week.grossCents)}</Td>
                      <Td className="text-xs">{usd(week.refundCents)}</Td>
                      <Td className="text-xs">{usd(week.netCents)}</Td>
                      <Td className="text-xs">{week.ticketCount}</Td>
                      <Td className="text-xs">{usd(week.avgTicketCents)}</Td>
                      <Td className="text-xs">
                        {Object.entries(week.attributedBySource)
                          .map(([source, cents]) => `${source} ${usd(cents)}`)
                          .join(", ")}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Unmatched payments" meta="Needs a phone or email match">
          {(data?.unmatched ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No unmatched payments in the latest 25.</p>
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Payment</Th>
                    <Th>Status</Th>
                    <Th>Amount</Th>
                    <Th>Card</Th>
                    <Th>Match</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.unmatched.map((payment) => (
                    <tr key={payment.squareId}>
                      <Td className="text-xs">{fmt(payment.createdAt)}</Td>
                      <Td className="font-mono text-xs">{payment.squareId}</Td>
                      <Td className="text-xs">{payment.status}</Td>
                      <Td className="text-xs">{usd(payment.amountCents)}</Td>
                      <Td className="text-xs">
                        {[payment.cardBrand, payment.cardLast4].filter(Boolean).join(" ")}
                      </Td>
                      <Td className="text-xs">{payment.matchStatus}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
