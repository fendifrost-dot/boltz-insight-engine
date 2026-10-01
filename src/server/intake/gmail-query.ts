// Gmail search string for lead notification mail. Pure; no I/O.

/** Inclusive lower bound for backfill / dry-run when `since` is omitted. */
export const EMAIL_INTAKE_DEFAULT_SINCE = "2026-09-26T00:00:00.000Z";

/** How far incremental polls look back. Overlaps a missed run. */
export const EMAIL_INTAKE_LOOKBACK_MS = 36 * 60 * 60 * 1000;

/** Refuse a since that would page the whole mailbox. */
export const EMAIL_INTAKE_MAX_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

const LEAD_MAIL_CLAUSE = [
  "from:messaging.yelp.com",
  'subject:"requesting a quote"',
  "from:notifications@email.durable.com",
  "from:support@durable.team",
  'subject:"New website lead"',
  "from:local-services-noreply@google.com",
  'subject:"Local Services"',
  "(from:businessprofile-noreply@google.com subject:message)",
  'subject:"You have a new lead"',
].join(" OR ");

/**
 * Gmail `after:` is exclusive of that calendar day, so the query day is the
 * UTC day before `sinceMs`. Callers still drop messages older than `sinceMs`.
 */
export function gmailLeadQuery(sinceMs: number): string {
  const day = new Date(sinceMs - 24 * 60 * 60 * 1000);
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  return `after:${y}/${m}/${d} (${LEAD_MAIL_CLAUSE})`;
}

export function parseIntakeSince(
  raw: string | undefined,
  nowMs: number,
  fallbackMs: number,
): { sinceMs: number } | { error: string } {
  if (!raw || !raw.trim()) return { sinceMs: fallbackMs };
  const trimmed = raw.trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const ms = day ? Date.parse(`${day[1]}-${day[2]}-${day[3]}T00:00:00.000Z`) : Date.parse(trimmed);
  if (!Number.isFinite(ms)) return { error: "since must be YYYY-MM-DD" };
  if (ms > nowMs + 60_000) return { error: "since is in the future" };
  if (nowMs - ms > EMAIL_INTAKE_MAX_LOOKBACK_MS) return { error: "since is older than 120 days" };
  return { sinceMs: ms };
}
