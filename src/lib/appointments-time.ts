export const SHOP_TIMEZONE = "America/Chicago";

export class ShopLocalTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopLocalTimeError";
  }
}

type ShopLocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type ShopLocalDisambiguation = "earlier" | "later";

function parseShopLocalInput(date: string, time: string): ShopLocalParts {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    !year ||
    !month ||
    !day ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new ShopLocalTimeError("Invalid shop-local date/time");
  }
  return { year, month, day, hour, minute };
}

function partsInTimeZone(timeZone: string, instant: Date): ShopLocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function partsMatch(left: ShopLocalParts, right: ShopLocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function findMatchingInstants(args: {
  target: ShopLocalParts;
  timeZone: string;
  searchStartMs: number;
  searchEndMs: number;
}): number[] {
  const matches: number[] = [];
  for (let ms = args.searchStartMs; ms <= args.searchEndMs; ms += 60_000) {
    if (partsMatch(args.target, partsInTimeZone(args.timeZone, new Date(ms)))) {
      matches.push(ms);
    }
  }
  return matches;
}

export function formatAppointmentInstant(iso: string, timeZone = SHOP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Parse a shop-local date/time pair into UTC ISO using explicit Chicago rules. */
export function shopLocalToUtcIso(args: {
  date: string;
  time: string;
  timeZone?: string;
  disambiguation?: ShopLocalDisambiguation;
}): string {
  const timeZone = args.timeZone ?? SHOP_TIMEZONE;
  const target = parseShopLocalInput(args.date, args.time);
  const dayStart = Date.UTC(target.year, target.month - 1, target.day, 0, 0);
  const dayEnd = dayStart + 48 * 60 * 60_000;
  const matches = findMatchingInstants({
    target,
    timeZone,
    searchStartMs: dayStart - 12 * 60 * 60_000,
    searchEndMs: dayEnd,
  });

  if (matches.length === 0) {
    throw new ShopLocalTimeError(
      `${args.date} ${args.time} does not exist in ${timeZone} (clock skipped for daylight saving)`,
    );
  }

  if (matches.length > 1) {
    if (!args.disambiguation) {
      throw new ShopLocalTimeError(
        `${args.date} ${args.time} is ambiguous in ${timeZone}; specify earlier or later offset`,
      );
    }
    const chosen = args.disambiguation === "earlier" ? matches[0] : matches[matches.length - 1];
    return new Date(chosen).toISOString();
  }

  return new Date(matches[0]).toISOString();
}

export function shopLocalDateFromInstant(iso: string, timeZone = SHOP_TIMEZONE): string {
  const parts = partsInTimeZone(timeZone, new Date(iso));
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function shopLocalTimeFromInstant(iso: string, timeZone = SHOP_TIMEZONE): string {
  const parts = partsInTimeZone(timeZone, new Date(iso));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function shopLocalToday(timeZone = SHOP_TIMEZONE): string {
  return shopLocalDateFromInstant(new Date().toISOString(), timeZone);
}

export function shopStartOfWeek(date: string, timeZone = SHOP_TIMEZONE): string {
  const noonUtc = shopLocalToUtcIso({ date, time: "12:00", timeZone });
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(noonUtc));
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  if (weekdayIndex < 0) {
    throw new ShopLocalTimeError("Could not resolve shop-local weekday");
  }
  const offsetDays = weekdayIndex === 0 ? -6 : 1 - weekdayIndex;
  const [year, month, day] = date.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  const weekStart = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
  return weekStart;
}

export function shopDayRangeIso(date: string, timeZone = SHOP_TIMEZONE): { fromIso: string; toIso: string } {
  const fromIso = shopLocalToUtcIso({ date, time: "00:00", timeZone });
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const toIso = shopLocalToUtcIso({ date: nextDate, time: "00:00", timeZone });
  return { fromIso, toIso };
}

export function shopWeekRangeIso(weekStartDate: string, timeZone = SHOP_TIMEZONE): { fromIso: string; toIso: string } {
  const fromIso = shopLocalToUtcIso({ date: weekStartDate, time: "00:00", timeZone });
  const [year, month, day] = weekStartDate.split("-").map(Number);
  const endAnchor = new Date(Date.UTC(year, month - 1, day));
  endAnchor.setUTCDate(endAnchor.getUTCDate() + 7);
  const weekEndDate = `${endAnchor.getUTCFullYear()}-${String(endAnchor.getUTCMonth() + 1).padStart(2, "0")}-${String(endAnchor.getUTCDate()).padStart(2, "0")}`;
  const toIso = shopLocalToUtcIso({ date: weekEndDate, time: "00:00", timeZone });
  return { fromIso, toIso };
}

export function formatShopLocalDayLabel(date: string, timeZone = SHOP_TIMEZONE): string {
  const iso = shopLocalToUtcIso({ date, time: "12:00", timeZone });
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}
