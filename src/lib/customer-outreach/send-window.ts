/**
 * PROPOSAL SKETCH — America/Chicago send window.
 *
 * Reminder and check-in SMS may only go out 9:00 AM–5:00 PM CT, Monday–Saturday.
 * Never Sunday. Never outside those hours. DST is Chicago-local, not UTC.
 *
 * Not imported by the live send path.
 */

export const OUTREACH_TIME_ZONE = "America/Chicago";
export const WINDOW_START_HOUR = 9;
export const WINDOW_END_HOUR = 17;

export type ChicagoParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function chicagoParts(at: Date): ChicagoParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: OUTREACH_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(bag["year"]),
    month: Number(bag["month"]),
    day: Number(bag["day"]),
    hour: Number(bag["hour"]),
    minute: Number(bag["minute"]),
    weekday: weekdayMap[bag["weekday"] ?? ""] ?? -1,
  };
}

export function chicagoLocalDate(at: Date): string {
  const p = chicagoParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isWithinOutreachSendWindow(at: Date): boolean {
  const p = chicagoParts(at);
  if (p.weekday === 0 || p.weekday < 0) return false;
  if (p.hour < WINDOW_START_HOUR) return false;
  if (p.hour > WINDOW_END_HOUR) return false;
  if (p.hour === WINDOW_END_HOUR && p.minute > 0) return false;
  return true;
}

/** Appointment blocks offered in reminder copy. Weekdays only. Never 8 AM. */
export const APPOINTMENT_WINDOWS = ["9-11", "11-1", "1-3", "2-4"] as const;
