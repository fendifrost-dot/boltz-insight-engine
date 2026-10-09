import { LIFECYCLE_FUNNEL, type Lifecycle } from "../../lib/lifecycle-transitions.ts";

const FUNNEL = new Set<string>(LIFECYCLE_FUNNEL);

export function shouldMarkLeadPaid(args: {
  paymentStatus: string;
  matchStatus: string;
  lifecycle: string;
}): boolean {
  if (args.paymentStatus !== "COMPLETED") return false;
  if (args.matchStatus !== "exact_phone" && args.matchStatus !== "exact_email") return false;
  return FUNNEL.has(args.lifecycle) && args.lifecycle !== "Paid";
}

export function leadSquareRevenue(
  payments: {
    status: string;
    amountCents: number;
    refundedCents: number;
    createdAt: string | null;
  }[],
): { grossCents: number; netCents: number; paidAt: string | null } {
  let grossCents = 0;
  let netCents = 0;
  let paidAt: string | null = null;
  for (const payment of payments) {
    if (payment.status !== "COMPLETED") continue;
    const amount = Math.max(0, payment.amountCents);
    const refunded = Math.max(0, payment.refundedCents);
    grossCents += amount;
    netCents += Math.max(0, amount - refunded);
    if (payment.createdAt && (!paidAt || payment.createdAt > paidAt)) paidAt = payment.createdAt;
  }
  return { grossCents, netCents, paidAt };
}

export function isFunnelLifecycle(value: string): value is Lifecycle {
  return FUNNEL.has(value);
}
