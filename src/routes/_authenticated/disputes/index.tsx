import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { TableWrap, Tag, Td, Th } from "@/components/ops/Bits";
import { listSquareDisputes } from "@/lib/square.functions";

export const Route = createFileRoute("/_authenticated/disputes/")({
  head: () => ({
    meta: [
      { title: "Disputes · Boltz SEO/GEO Ops" },
      {
        name: "description",
        content: "Square chargebacks sorted by response deadline, with the evidence still needed.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DisputesPage,
});

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmt(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "No deadline";
}

function stateTone(state: string, dueSoon: boolean): "danger" | "warning" | "success" | "neutral" {
  if (dueSoon) return "danger";
  if (state === "LOST" || state === "ACCEPTED") return "danger";
  if (state === "WON") return "success";
  if (state === "EVIDENCE_REQUIRED" || state === "INQUIRY_EVIDENCE_REQUIRED") return "warning";
  return "neutral";
}

function DisputesPage() {
  const listFn = useServerFn(listSquareDisputes);
  const list = useQuery({ queryKey: ["square-disputes"], queryFn: () => listFn() });
  const data = list.data;
  const alert = data?.deadlines;

  return (
    <Shell>
      <PageHeader
        kicker="Payments"
        title="Disputes"
        description="Square chargebacks, soonest deadline first. The checklist stays in this app. Nothing here is sent to Square."
      />
      <div className="space-y-4">
        {alert && alert.count > 0 && (
          <Panel title="Due within 3 days">
            <p className="text-sm">
              {alert.count} {alert.count === 1 ? "dispute needs" : "disputes need"} a response by{" "}
              {fmt(alert.nearestDueBy)}. Overdue disputes are included.
            </p>
          </Panel>
        )}
        <Panel title="All disputes" meta="Sorted by due date">
          {list.isLoading && <p className="text-sm text-muted-foreground">Loading disputes…</p>}
          {list.isError && (
            <p className="text-sm text-destructive">
              {list.error instanceof Error ? list.error.message : "Could not load disputes"}
            </p>
          )}
          {data && data.disputes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No disputes stored yet. The hourly Square sync and dispute webhooks fill this list.
            </p>
          )}
          {data && data.disputes.length > 0 && (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Due</Th>
                    <Th>Amount</Th>
                    <Th>State</Th>
                    <Th>Reason</Th>
                    <Th>Card</Th>
                    <Th>Lead</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.disputes.map((dispute) => (
                    <tr key={dispute.disputeId}>
                      <Td className="text-xs">
                        <Link
                          to="/disputes/$disputeId"
                          params={{ disputeId: dispute.disputeId }}
                          className="underline"
                        >
                          {fmt(dispute.dueBy)}
                        </Link>
                      </Td>
                      <Td className="text-xs">{usd(dispute.amountCents)}</Td>
                      <Td>
                        <Tag tone={stateTone(dispute.state, dispute.dueSoon)}>{dispute.state}</Tag>
                      </Td>
                      <Td className="text-xs">{dispute.reason}</Td>
                      <Td className="text-xs">
                        {[dispute.cardBrand, dispute.cardLast4].filter(Boolean).join(" ")}
                      </Td>
                      <Td className="text-xs">
                        {dispute.leadId ? (
                          <Link
                            to="/desk/leads/$leadId"
                            params={{ leadId: dispute.leadId }}
                            className="underline"
                          >
                            {dispute.matchStatus}
                          </Link>
                        ) : (
                          dispute.matchStatus
                        )}
                      </Td>
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
