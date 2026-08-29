import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, PageHeader, Panel } from "@/components/ops/Shell";
import { Td, TableWrap, Tag, Th } from "@/components/ops/Bits";
import { getAdsPerformance, getAdsStatus } from "@/lib/google-ads.functions";

export const Route = createFileRoute("/_authenticated/ads")({
  component: AdsPage,
  head: () => ({
    meta: [
      { title: "Google Ads — Boltz SEO/GEO Ops" },
      {
        name: "description",
        content:
          "Internal Google Ads API read surface for Boltz Automotive: campaign spend, search terms, and freeze-gated change control.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function AdsPage() {
  const statusFn = useServerFn(getAdsStatus);
  const perfFn = useServerFn(getAdsPerformance);

  const status = useQuery({ queryKey: ["ads-status"], queryFn: () => statusFn({}) });
  const perf = useQuery({
    queryKey: ["ads-performance", 30],
    queryFn: () => perfFn({ data: { days: 30 } }),
    enabled: Boolean(status.data?.reachable),
  });

  const s = status.data;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Paid search"
        title="Google Ads"
        description="Live read-only pull from the Google Ads API. Writes require owner confirmation and stay blocked by the change-control freeze until 2026-08-29 10:00 America/Chicago."
      />

      <Panel
        title="Connection"
        meta={s ? (s.reachable ? "Reachable" : "Not reachable") : "Checking…"}
      >
        {status.isPending && <p className="text-sm text-muted-foreground">Checking credentials…</p>}
        {s && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Tag tone={s.reachable ? "success" : "warning"}>
                {s.reachable ? `Connected${s.accountName ? ` · ${s.accountName}` : ""}` : "Offline"}
              </Tag>
              <Tag tone={s.writeFreezeActive ? "warning" : "neutral"}>
                {s.writeFreezeActive ? "Write freeze ACTIVE" : "Writes permitted after approval"}
              </Tag>
            </div>
            {s.detail && (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs break-words text-muted-foreground">
                {s.detail}
              </p>
            )}
            {!s.reachable && s.nextStep && (
              <div className="space-y-2 rounded-md border border-border px-3 py-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Error class · </span>
                  <span className="font-mono text-xs">{s.errorClass}</span>
                  {s.googleCode ? (
                    <span className="font-mono text-xs text-muted-foreground"> · {s.googleCode}</span>
                  ) : null}
                </p>
                {s.nextStep && <p>{s.nextStep}</p>}
                {s.accessibleMasks.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    OAuth user can access: {s.accessibleMasks.join(", ")}
                    {s.configuredCustomerInAccessible === false && " · configured customer not in list"}
                    {s.configuredLoginInAccessible === false && " · configured login-customer-id not in list"}
                    {s.directAccessOk === true && " · direct access without login-customer-id succeeded"}
                    {s.directAccessOk === false && " · direct access without login-customer-id also failed"}
                  </p>
                )}
              </div>
            )}
            <TableWrap>
              <thead>
                <tr>
                  <Th>Secret</Th>
                  <Th>State</Th>
                  <Th>Identifier</Th>
                </tr>
              </thead>
              <tbody>
                {s.secrets.map((sec) => (
                  <tr key={sec.name}>
                    <Td className="font-mono text-xs">{sec.name}</Td>
                    <Td>
                      {sec.configured ? (
                        <Tag tone="success">Configured</Tag>
                      ) : sec.optional ? (
                        <Tag tone="neutral">Optional · not set</Tag>
                      ) : (
                        <Tag tone="warning">Missing</Tag>
                      )}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {sec.masked ?? "—"}
                      {sec.shape && !sec.shape.ok && (
                        <span className="mt-1 block text-destructive">{sec.shape.warning}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Panel>

      <Panel title="Campaigns · last 30 days" meta={perf.data?.ok ? "Live" : "Not entered"}>
        {!s?.reachable && (
          <EmptyState
            label="No live data"
            hint="Connect the Google Ads API credentials above to pull campaign spend."
          />
        )}
        {perf.data?.error && (
          <p className="font-mono text-xs text-destructive">{perf.data.error}</p>
        )}
        {perf.data?.ok && perf.data.campaigns.length === 0 && (
          <EmptyState label="No campaigns returned" hint="The account reported no spend in range." />
        )}
        {perf.data?.ok && perf.data.campaigns.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Status</Th>
                <Th className="text-right">Impr.</Th>
                <Th className="text-right">Clicks</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Conv.</Th>
                <Th className="text-right">Avg CPC</Th>
              </tr>
            </thead>
            <tbody>
              {perf.data.campaigns.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td className="text-xs">{c.status}</Td>
                  <Td className="text-right">{c.impressions.toLocaleString()}</Td>
                  <Td className="text-right">{c.clicks.toLocaleString()}</Td>
                  <Td className="text-right">{usd(c.cost)}</Td>
                  <Td className="text-right">{c.conversions.toFixed(1)}</Td>
                  <Td className="text-right">{usd(c.avgCpc)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Search terms · last 30 days" meta="Highest spend first">
        {perf.data?.ok && perf.data.searchTerms.length > 0 ? (
          <TableWrap>
            <thead>
              <tr>
                <Th>Search term</Th>
                <Th>Campaign</Th>
                <Th className="text-right">Clicks</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Conv.</Th>
              </tr>
            </thead>
            <tbody>
              {perf.data.searchTerms.slice(0, 60).map((t, i) => (
                <tr key={`${t.term}-${i}`}>
                  <Td className="font-mono text-xs">{t.term}</Td>
                  <Td className="text-xs text-muted-foreground">{t.campaign}</Td>
                  <Td className="text-right">{t.clicks.toLocaleString()}</Td>
                  <Td className="text-right">{usd(t.cost)}</Td>
                  <Td className="text-right">{t.conversions.toFixed(1)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            label="Not entered"
            hint="Search-term data appears once the API connection succeeds."
          />
        )}
      </Panel>

      <Panel title="Change control">
        <p className="text-sm text-muted-foreground">
          Campaign status writes are implemented server-side (owner capability + explicit
          confirmation + dry-run default), but stay refused while the freeze is active. After the
          freeze lifts, findings from this page go through the Decision Queue —
          finding → hypothesis → proposed intervention → approval → deployment → measurement.
        </p>
      </Panel>
    </div>
  );
}
