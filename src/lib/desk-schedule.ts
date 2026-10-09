export const SHOP_TIME_ZONE = "America/Chicago";

export function shopDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function appointmentLocal(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Resolve the shop's wall clock, regardless of the receptionist's device zone. */
export function chicagoAppointmentIso(local: string): string | null {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const matches = ["-05:00", "-06:00"]
    .map((offset) => new Date(`${local}:00${offset}`))
    .filter(
      (date) => Number.isFinite(date.getTime()) && appointmentLocal(date.toISOString()) === local,
    );
  // Reject nonexistent spring times and ambiguous fall times instead of guessing.
  return matches.length === 1 ? matches[0]!.toISOString() : null;
}

export function shopDayBounds(date = shopDate()): { start: string; end: string; date: string } {
  const start = chicagoAppointmentIso(`${date}T00:00`);
  if (!start) throw new Error("Choose a valid shop date.");
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = chicagoAppointmentIso(`${next.toISOString().slice(0, 10)}T00:00`);
  if (!end) throw new Error("Choose a valid shop date.");
  return { start, end, date };
}

export function appointmentLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
