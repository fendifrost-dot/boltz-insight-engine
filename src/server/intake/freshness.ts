// Pure freshness rule for integration_health_snapshots. No I/O.

export const SHOP_TIME_ZONE = "America/Chicago";

/** Hours without a new lead, on a business day, before the check is not ok. */
export const FRESHNESS_QUIET_HOURS = {
  yelp: 48,
  durable: 48,
  google_lsa: 48,
  google_gbp: 48,
  google_ads: 48,
  meta: 48,
  ringcentral: 36,
} as const;

export type FreshnessProvider = keyof typeof FRESHNESS_QUIET_HOURS;

export type FreshnessSource = {
  provider: FreshnessProvider;
  label: string;
  leadSources: readonly string[];
  quietHours: number;
};

export const FRESHNESS_SOURCES: readonly FreshnessSource[] = [
  { provider: "yelp", label: "Yelp", leadSources: ["Yelp"], quietHours: FRESHNESS_QUIET_HOURS.yelp },
  {
    provider: "durable",
    label: "Durable website",
    leadSources: ["Durable website"],
    quietHours: FRESHNESS_QUIET_HOURS.durable,
  },
  {
    provider: "google_lsa",
    label: "Google LSA",
    leadSources: ["Google LSA"],
    quietHours: FRESHNESS_QUIET_HOURS.google_lsa,
  },
  {
    provider: "google_gbp",
    label: "Google Business Profile",
    leadSources: ["Google Business Profile"],
    quietHours: FRESHNESS_QUIET_HOURS.google_gbp,
  },
  {
    provider: "google_ads",
    label: "Google Ads",
    leadSources: ["Google Ads"],
    quietHours: FRESHNESS_QUIET_HOURS.google_ads,
  },
  {
    provider: "meta",
    label: "Meta Lead Ads",
    leadSources: ["Facebook Lead Ads", "Instagram Lead Ads"],
    quietHours: FRESHNESS_QUIET_HOURS.meta,
  },
  {
    provider: "ringcentral",
    label: "RingCentral SMS",
    leadSources: ["RingCentral SMS"],
    quietHours: FRESHNESS_QUIET_HOURS.ringcentral,
  },
];

/** Monday–Saturday in the shop time zone. Sunday is closed. */
export function isBusinessDay(now: Date, timeZone = SHOP_TIME_ZONE): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  return weekday !== "Sun";
}

export function freshnessVerdict(args: {
  now: Date;
  lastLeadAt: string | null;
  quietHours: number;
  label: string;
  timeZone?: string;
}): { ok: boolean; detail: string } {
  if (!isBusinessDay(args.now, args.timeZone ?? SHOP_TIME_ZONE)) {
    return { ok: true, detail: `${args.label}: shop closed; freshness not required` };
  }
  if (!args.lastLeadAt) {
    return { ok: false, detail: `${args.label}: 0 leads recorded` };
  }
  const lastMs = Date.parse(args.lastLeadAt);
  if (!Number.isFinite(lastMs)) {
    return { ok: false, detail: `${args.label}: last lead timestamp is unreadable` };
  }
  const ageHours = (args.now.getTime() - lastMs) / 3_600_000;
  const age = Math.max(0, Math.floor(ageHours));
  if (ageHours >= args.quietHours) {
    return {
      ok: false,
      detail: `${args.label}: 0 leads in ${age}h on a business day (threshold ${args.quietHours}h)`,
    };
  }
  return {
    ok: true,
    detail: `${args.label}: last lead ${age}h ago (threshold ${args.quietHours}h)`,
  };
}
