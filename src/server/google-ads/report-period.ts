// Pure reporting-window math for Google Ads reports. No secrets, no I/O, no imports.
//
// Reporting dates are resolved to explicit calendar dates in the *account's*
// time zone rather than left as a relative `LAST_7_DAYS` literal, so a stored
// report says exactly which days it covers and reconciles against the Ads UI.

/** Google Ads `LAST_7_DAYS` excludes today; an explicit window must do the same. */
export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 90;

export type AdsReportPeriod = {
  /** Inclusive first day of the window, `YYYY-MM-DD` in the account time zone. */
  start: string;
  /** Inclusive last day of the window, `YYYY-MM-DD` in the account time zone. */
  end: string;
  days: number;
  time_zone: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Current calendar date in `timeZone` as `YYYY-MM-DD`. */
function todayInTimeZone(timeZone: string, now: Date): string {
  // `en-CA` formats as YYYY-MM-DD, which is exactly the GAQL date literal.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift a `YYYY-MM-DD` value by whole days. */
function shiftDate(isoDate: string, deltaDays: number): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the reporting window. Mirrors Google's `LAST_N_DAYS` semantics: the
 * window ends yesterday, so a partial current day never lands in a report.
 */
export function resolveReportPeriod(args: {
  timeZone: string;
  days?: number | undefined;
  now?: Date | undefined;
}): AdsReportPeriod {
  const timeZone = isSupportedTimeZone(args.timeZone) ? args.timeZone : "UTC";
  const requested = Math.trunc(args.days ?? DEFAULT_WINDOW_DAYS);
  const days = Math.min(
    Math.max(Number.isFinite(requested) ? requested : DEFAULT_WINDOW_DAYS, 1),
    MAX_WINDOW_DAYS,
  );

  const today = todayInTimeZone(timeZone, args.now ?? new Date());
  const end = shiftDate(today, -1);
  const start = shiftDate(end, -(days - 1));

  return { start, end, days, time_zone: timeZone };
}

/** GAQL date literal guard. Dates are built from integers, never caller text. */
export function assertDateLiteral(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid reporting date");
  return value;
}

/** `segments.date` range clause for a resolved period. */
export function dateClause(period: AdsReportPeriod): string {
  return `segments.date BETWEEN '${assertDateLiteral(period.start)}' AND '${assertDateLiteral(period.end)}'`;
}
