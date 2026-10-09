export const INCREMENTAL_OVERLAP_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_INCREMENTAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** `since` is an inclusive UTC date. Weekly buckets stay on America/Chicago Mondays. */
export function parseSinceDate(
  raw: string | null | undefined,
  now = new Date(),
): { ok: true; date: string } | { ok: false; error: string } {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "since is required for backfill (YYYY-MM-DD)" };
  }
  const date = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "since must be YYYY-MM-DD" };
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return { ok: false, error: "since is not a valid date" };
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year!, month! - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month! - 1 ||
    check.getUTCDate() !== day
  ) {
    return { ok: false, error: "since is not a valid date" };
  }
  const today = now.toISOString().slice(0, 10);
  if (date > today) return { ok: false, error: "since cannot be in the future" };
  if (date < "2010-01-01") return { ok: false, error: "since is too early" };
  return { ok: true, date };
}

export function syncBeginIso(args: {
  mode: "incremental" | "backfill";
  sinceDate: string | null;
  syncedThrough: string | null;
  now: Date;
}): string {
  if (args.mode === "backfill") {
    if (!args.sinceDate) throw new Error("since is required for backfill");
    return `${args.sinceDate}T00:00:00.000Z`;
  }
  if (args.syncedThrough) {
    const ms = Date.parse(args.syncedThrough);
    if (Number.isFinite(ms)) return new Date(ms - INCREMENTAL_OVERLAP_MS).toISOString();
  }
  return new Date(args.now.getTime() - DEFAULT_INCREMENTAL_LOOKBACK_MS).toISOString();
}

/** Monday (America/Chicago) of the week containing `iso`, as YYYY-MM-DD. */
export function chicagoWeekStart(iso: string): string | null {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!year || !month || !day) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dow = utc.getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  utc.setUTCDate(utc.getUTCDate() - delta);
  return utc.toISOString().slice(0, 10);
}

export type RollupPayment = {
  status: string;
  amountCents: number;
  createdAt: string | null;
  leadId: string | null;
};

export type RollupRefund = {
  status: string;
  amountCents: number;
  createdAt: string | null;
};

export type WeekRollup = {
  weekStart: string;
  grossCents: number;
  refundCents: number;
  netCents: number;
  ticketCount: number;
  avgTicketCents: number;
  attributedBySource: Record<string, number>;
};

export function rollupSquareWeeks(args: {
  payments: RollupPayment[];
  refunds: RollupRefund[];
  leadSources: Map<string, string | null>;
  since?: string | null;
  until?: string | null;
}): WeekRollup[] {
  const weeks = new Map<string, WeekRollup>();
  const ensure = (weekStart: string): WeekRollup => {
    const existing = weeks.get(weekStart);
    if (existing) return existing;
    const created: WeekRollup = {
      weekStart,
      grossCents: 0,
      refundCents: 0,
      netCents: 0,
      ticketCount: 0,
      avgTicketCents: 0,
      attributedBySource: {},
    };
    weeks.set(weekStart, created);
    return created;
  };

  for (const payment of args.payments) {
    if (payment.status !== "COMPLETED" || !payment.createdAt) continue;
    const week = chicagoWeekStart(payment.createdAt);
    if (!week) continue;
    const row = ensure(week);
    row.grossCents += payment.amountCents;
    row.ticketCount += 1;
    if (payment.leadId) {
      const source = args.leadSources.get(payment.leadId);
      const key = source && source.trim().length > 0 ? source : "unknown";
      row.attributedBySource[key] = (row.attributedBySource[key] ?? 0) + payment.amountCents;
    }
  }

  for (const refund of args.refunds) {
    if (refund.status !== "COMPLETED" || !refund.createdAt) continue;
    const week = chicagoWeekStart(refund.createdAt);
    if (!week) continue;
    ensure(week).refundCents += refund.amountCents;
  }

  const since = args.since ?? null;
  const until = args.until ?? null;
  return [...weeks.values()]
    .filter(
      (week) =>
        (since ? week.weekStart >= since : true) && (until ? week.weekStart <= until : true),
    )
    .map((week) => ({
      ...week,
      netCents: week.grossCents - week.refundCents,
      avgTicketCents: week.ticketCount === 0 ? 0 : Math.floor(week.grossCents / week.ticketCount),
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0));
}

export function dollarsFromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}
