import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Panel } from "@/components/ops/Shell";
import { Tag } from "@/components/ops/Bits";
import { getSquareDashboard } from "@/lib/square.functions";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function SquareHealthPanel() {
  const dashboardFn = useServerFn(getSquareDashboard);
  const health = useQuery({
    queryKey: ["square-dashboard"],
    queryFn: () => dashboardFn(),
    retry: 1,
  });
  const data = health.data;
  const lastSync = (data?.sync ?? [])
    .map((row) => row.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <Panel
      title="Square"
      meta={
        <Link to="/square" className="text-[10px] underline">
          Open Square
        </Link>
      }
    >
      {health.isLoading && <p className="text-sm text-muted-foreground">Checking Square…</p>}
      {health.isError && (
        <p className="text-sm text-destructive">
          {health.error instanceof Error ? health.error.message : "Square status failed"}
        </p>
      )}
      {data && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={data.configured ? "success" : "warning"}>
              {data.configured ? "Connected" : "Not configured"}
            </Tag>
            {data.environment && <Tag tone="info">{data.environment}</Tag>}
            <Tag tone={data.signatureConfigured ? "success" : "warning"}>
              {data.signatureConfigured ? "Webhook key set" : "Webhook key missing"}
            </Tag>
            {data.locationMode === "ambiguous" && <Tag tone="warning">Multiple locations</Tag>}
            {data.locationMode === "discovered" && <Tag tone="success">One location</Tag>}
          </div>
          {data.applicationId && (
            <p className="font-mono text-xs text-muted-foreground">
              Application {data.applicationId}
            </p>
          )}
          {!data.configured && data.reason && (
            <p className="text-xs text-muted-foreground">{data.reason}</p>
          )}
          {!data.signatureConfigured && (
            <p className="text-xs text-muted-foreground">
              Events are rejected until SQUARE_WEBHOOK_SIGNATURE_KEY is set. See docs/SQUARE.md.
            </p>
          )}
          {data.locationMode === "ambiguous" && (
            <p className="text-xs text-muted-foreground">
              {data.locations.filter((location) => location.status === "ACTIVE").length} active
              locations. Set SQUARE_LOCATION_ID to pin one. Nothing was guessed.
            </p>
          )}
          {data.locationMode === "discovered" && data.resolvedLocationId && (
            <p className="font-mono text-xs text-muted-foreground">
              Using {data.resolvedLocationId}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Last sync {lastSync ? new Date(lastSync).toLocaleString() : "never"}
            {data.weeks[0] ? ` · latest week net ${usd(data.weeks[0].netCents)}` : ""}
            {` · ${data.unmatched.length} unmatched on this page`}
          </p>
          {data.storageError && (
            <p className="text-xs text-destructive">Storage {data.storageError}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
