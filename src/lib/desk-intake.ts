// Pure shop-desk rules. No database, no logging, no customer values in return metadata.
import {
  isAllowedLifecycleTransition,
  LIFECYCLE_VALUES,
  type Lifecycle,
  type LifecycleEvidenceBasis,
} from "./lifecycle-transitions.ts";

/** Same phone logged inside this window is a soft duplicate, not a second card. */
export const DESK_DUPE_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Recent Google Ads call numbers the desk will link to a phone lead. */
export const DESK_ADS_CALL_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export const DESK_CHANNELS = ["walk_in", "phone"] as const;
export type DeskChannel = (typeof DESK_CHANNELS)[number];

export const DESK_HEARD_ABOUT = [
  "google",
  "yelp",
  "facebook",
  "instagram",
  "referral",
  "returning",
  "drive_by",
  "other",
] as const;
export type DeskHeardAbout = (typeof DESK_HEARD_ABOUT)[number];

export const HEARD_ABOUT_LABEL: Record<DeskHeardAbout, string> = {
  google: "Google",
  yelp: "Yelp",
  facebook: "Facebook",
  instagram: "Instagram",
  referral: "Friend or family",
  returning: "Returning customer",
  drive_by: "Saw the shop",
  other: "Other",
};

/**
 * lead_source strings already used by email intake, Meta, and Square rollups,
 * plus the three offline answers that had no online bucket. Reporting groups
 * on this column. heard_about is only the desk pick key.
 */
export const CANONICAL_LEAD_SOURCES = [
  "Yelp",
  "Durable website",
  "Google LSA",
  "Google Business Profile",
  "Google Ads",
  "Facebook Lead Ads",
  "Instagram Lead Ads",
  "Referral",
  "Returning customer",
  "Drive-by",
  "RingCentral SMS",
] as const;

/** Mirrors bot-api LEAD_SOURCE_PATTERN. Compared in tests so the two cannot drift. */
export const DESK_LEAD_SOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _.:-]{0,99}$/;

const OTHER_ALIASES: Record<string, string> = {
  yelp: "Yelp",
  google: "Google Business Profile",
  "google ads": "Google Ads",
  "google ad": "Google Ads",
  "google lsa": "Google LSA",
  lsa: "Google LSA",
  "google business profile": "Google Business Profile",
  gbp: "Google Business Profile",
  facebook: "Facebook Lead Ads",
  meta: "Facebook Lead Ads",
  fb: "Facebook Lead Ads",
  instagram: "Instagram Lead Ads",
  ig: "Instagram Lead Ads",
  referral: "Referral",
  "returning customer": "Returning customer",
  "drive-by": "Drive-by",
  "drive by": "Drive-by",
};

export type AdsCallHit = {
  id: string;
  startedAt: string;
  weekStart: string;
  adsCallWeeklyId: string | null;
};

export type AdsCallLink = {
  id: string;
  startedAt: string;
  weekStart: string;
  adsCallWeeklyId: string | null;
};

export type DeskIntakeRequest = {
  channel: DeskChannel;
  name?: string | undefined;
  phone?: string | undefined;
  vehicleYear?: number | null | undefined;
  vehicleMake?: string | undefined;
  vehicleModel?: string | undefined;
  concern?: string | undefined;
  heardAbout: DeskHeardAbout;
  heardAboutOther?: string | undefined;
  appointmentInterest: boolean;
  notes?: string | undefined;
  idempotencyKey: string;
};

export type NormalizedDeskIntake = {
  channel: DeskChannel;
  name: string | null;
  phone: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  concern: string | null;
  heardAbout: DeskHeardAbout;
  heardAboutOther: string | null;
  appointmentInterest: boolean;
  notes: string | null;
  idempotencyKey: string;
  staffUserId: string;
  now: Date;
};

export type DeskLeadInsert = {
  name: string | null;
  phone_e164: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  symptoms: string | null;
  lead_source: string;
  notes: string | null;
  lifecycle: "New";
  intake_path: "desk";
  intake_channel: DeskChannel;
  created_by: string;
  heard_about: DeskHeardAbout;
  appointment_interest: boolean;
  desk_idempotency_key: string;
  google_ads_call_id: string | null;
};

export type DeskEventMetadata = {
  intake_path: "desk";
  channel: DeskChannel;
  heard_about: DeskHeardAbout;
  lead_source?: string;
  google_ads_call_linked: boolean;
  week_start: string | null;
};

export type DeskPlan =
  | {
      action: "duplicate" | "existing" | "idempotent";
      leadId: string;
      googleAdsCall: AdsCallLink | null;
    }
  | {
      action: "create";
      row: DeskLeadInsert;
      event: {
        event_type: "desk_intake";
        actor: string;
        summary: string;
        metadata: DeskEventMetadata;
      };
      googleAdsCall: AdsCallLink | null;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** E.164 that satisfies public.leads.phone_e164. Same rules as email intake. */
export function toDeskE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  let e164: string | null = null;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    e164 = `+${digits}`;
  }
  if (!e164 || !/^\+[1-9][0-9]{7,14}$/.test(e164)) return null;
  return e164;
}

export function isDeskHeardAbout(value: string): value is DeskHeardAbout {
  return (DESK_HEARD_ABOUT as readonly string[]).includes(value);
}

export function isDeskChannel(value: string): value is DeskChannel {
  return (DESK_CHANNELS as readonly string[]).includes(value);
}

function blank(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) return null;
  return text;
}

export function mapHeardAboutToLeadSource(args: {
  heardAbout: DeskHeardAbout;
  otherText: string | null;
  googleAdsCallMatched: boolean;
}): { ok: true; leadSource: string } | { ok: false; reason: string } {
  switch (args.heardAbout) {
    case "yelp":
      return { ok: true, leadSource: "Yelp" };
    case "facebook":
      return { ok: true, leadSource: "Facebook Lead Ads" };
    case "instagram":
      return { ok: true, leadSource: "Instagram Lead Ads" };
    case "referral":
      return { ok: true, leadSource: "Referral" };
    case "returning":
      return { ok: true, leadSource: "Returning customer" };
    case "drive_by":
      return { ok: true, leadSource: "Drive-by" };
    case "google":
      return {
        ok: true,
        leadSource: args.googleAdsCallMatched ? "Google Ads" : "Google Business Profile",
      };
    case "other":
      return resolveOtherSource(args.otherText);
    default:
      return { ok: false, reason: "Choose how they heard about the shop" };
  }
}

function resolveOtherSource(
  otherText: string | null,
): { ok: true; leadSource: string } | { ok: false; reason: string } {
  const text = otherText?.trim() ?? "";
  if (!text) return { ok: false, reason: "Add a short note for Other" };
  if (text.length > 80) return { ok: false, reason: "Keep Other to a short phrase" };
  const alias = OTHER_ALIASES[text.toLowerCase()];
  if (alias) return { ok: true, leadSource: alias };
  const canonical = CANONICAL_LEAD_SOURCES.find(
    (source) => source.toLowerCase() === text.toLowerCase(),
  );
  if (canonical) return { ok: true, leadSource: canonical };
  if (!DESK_LEAD_SOURCE_PATTERN.test(text)) {
    return { ok: false, reason: "Use letters and numbers for Other" };
  }
  return { ok: true, leadSource: text };
}

export function phoneIntakeDisposition(args: {
  existingCreatedAt: string | null;
  now: Date;
  windowMs?: number;
}): "new" | "duplicate" | "existing" {
  if (!args.existingCreatedAt) return "new";
  const created = Date.parse(args.existingCreatedAt);
  if (!Number.isFinite(created)) return "existing";
  const windowMs = args.windowMs ?? DESK_DUPE_WINDOW_MS;
  const age = args.now.getTime() - created;
  if (age >= 0 && age <= windowMs) return "duplicate";
  return "existing";
}

export function pickGoogleAdsCall(args: {
  channel: DeskChannel;
  hits: AdsCallHit[];
  now: Date;
  lookbackMs?: number;
}): AdsCallLink | null {
  if (args.channel !== "phone") return null;
  const lookback = args.lookbackMs ?? DESK_ADS_CALL_LOOKBACK_MS;
  const nowMs = args.now.getTime();
  let best: AdsCallLink | null = null;
  let bestMs = -1;
  for (const hit of args.hits) {
    const started = Date.parse(hit.startedAt);
    if (!Number.isFinite(started)) continue;
    const age = nowMs - started;
    if (age < 0 || age > lookback) continue;
    if (started < bestMs) continue;
    bestMs = started;
    best = {
      id: hit.id,
      startedAt: new Date(started).toISOString(),
      weekStart: hit.weekStart,
      adsCallWeeklyId: hit.adsCallWeeklyId,
    };
  }
  return best;
}

export function deskEventMetadata(args: {
  channel: DeskChannel;
  heardAbout: DeskHeardAbout;
  leadSource: string;
  googleAdsCall: AdsCallLink | null;
}): DeskEventMetadata {
  const metadata: DeskEventMetadata = {
    intake_path: "desk",
    channel: args.channel,
    heard_about: args.heardAbout,
    google_ads_call_linked: Boolean(args.googleAdsCall),
    week_start: args.googleAdsCall?.weekStart ?? null,
  };
  if ((CANONICAL_LEAD_SOURCES as readonly string[]).includes(args.leadSource)) {
    metadata.lead_source = args.leadSource;
  }
  return metadata;
}

export function deskActor(isOwner: boolean, userId: string): string {
  return `${isOwner ? "owner" : "staff"}:${userId}`;
}

export function composeDeskNotes(args: {
  appointmentInterest: boolean;
  notes: string | null;
  now: Date;
}): string | null {
  const parts: string[] = [];
  if (args.appointmentInterest) parts.push("Appointment interest: yes");
  if (args.notes) parts.push(args.notes);
  if (parts.length === 0) return null;
  const stamp = `[desk ${args.now.toISOString().slice(0, 16)}Z]`;
  return `${stamp}\n${parts.join("\n")}`.slice(0, 8000);
}

export function appendDeskNote(
  existing: string | null,
  note: string,
  now: Date,
): { ok: true; notes: string } | { ok: false; reason: string } {
  const text = note.trim();
  if (!text) return { ok: false, reason: "Write a note first" };
  if (text.length > 2000) return { ok: false, reason: "Keep the note under 2000 characters" };
  const stamp = `[desk ${now.toISOString().slice(0, 16)}Z]`;
  const block = `${stamp}\n${text}`;
  const combined = [existing?.trim(), block].filter(Boolean).join("\n\n");
  if (combined.length <= 8000) return { ok: true, notes: combined };
  return { ok: true, notes: combined.slice(combined.length - 8000) };
}

export function deskNoteEvent(
  noteLength: number,
  actor: string,
): {
  event_type: "desk_note";
  actor: string;
  summary: string;
  metadata: { notes_length: number };
} {
  return {
    event_type: "desk_note",
    actor,
    summary: "Desk note added",
    metadata: { notes_length: noteLength },
  };
}

export function normalizeDeskIntake(
  input: DeskIntakeRequest,
  now: Date,
  staffUserId: string,
): { ok: true; normalized: NormalizedDeskIntake } | { ok: false; reason: string } {
  if (!isDeskChannel(input.channel)) return { ok: false, reason: "Choose walk-in or phone" };
  if (!isDeskHeardAbout(input.heardAbout)) {
    return { ok: false, reason: "Choose how they heard about the shop" };
  }
  if (!UUID_RE.test(staffUserId)) return { ok: false, reason: "Sign in again" };
  if (!UUID_RE.test(input.idempotencyKey)) return { ok: false, reason: "Save again" };

  const phoneRaw = input.phone?.trim() ?? "";
  let phone: string | null = null;
  if (phoneRaw) {
    phone = toDeskE164(phoneRaw);
    if (!phone) return { ok: false, reason: "Enter a 10-digit phone number" };
  }

  const nameRaw = input.name?.trim() ?? "";
  if (nameRaw.length > 120) return { ok: false, reason: "Shorten the name" };
  const makeRaw = input.vehicleMake?.trim() ?? "";
  const modelRaw = input.vehicleModel?.trim() ?? "";
  if (makeRaw.length > 40 || modelRaw.length > 40) {
    return { ok: false, reason: "Shorten the vehicle make or model" };
  }
  const concernRaw = input.concern?.trim() ?? "";
  if (concernRaw.length > 2000) return { ok: false, reason: "Shorten the concern" };
  const notesRaw = input.notes?.trim() ?? "";
  if (notesRaw.length > 2000) return { ok: false, reason: "Shorten the notes" };
  const otherRaw = input.heardAboutOther?.trim() ?? "";
  if (input.heardAbout === "other" && !otherRaw) {
    return { ok: false, reason: "Add a short note for Other" };
  }
  if (otherRaw.length > 80) return { ok: false, reason: "Keep Other to a short phrase" };

  let vehicleYear: number | null = null;
  if (input.vehicleYear !== undefined && input.vehicleYear !== null) {
    if (
      !Number.isInteger(input.vehicleYear) ||
      input.vehicleYear < 1900 ||
      input.vehicleYear > 2100
    ) {
      return { ok: false, reason: "Enter a four-digit vehicle year" };
    }
    vehicleYear = input.vehicleYear;
  }

  return {
    ok: true,
    normalized: {
      channel: input.channel,
      name: blank(nameRaw, 120),
      phone,
      vehicleYear,
      vehicleMake: blank(makeRaw, 40),
      vehicleModel: blank(modelRaw, 40),
      concern: blank(concernRaw, 2000),
      heardAbout: input.heardAbout,
      heardAboutOther: blank(otherRaw, 80),
      appointmentInterest: input.appointmentInterest,
      notes: blank(notesRaw, 2000),
      idempotencyKey: input.idempotencyKey.toLowerCase(),
      staffUserId,
      now,
    },
  };
}

export function decideDeskIntake(args: {
  intake: NormalizedDeskIntake;
  actor: string;
  existing: { id: string; createdAt: string } | null;
  idempotentLeadId: string | null;
  adsHits: AdsCallHit[];
}): { ok: true; plan: DeskPlan } | { ok: false; reason: string } {
  const googleAdsCall = pickGoogleAdsCall({
    channel: args.intake.channel,
    hits: args.adsHits,
    now: args.intake.now,
  });
  if (args.idempotentLeadId) {
    return {
      ok: true,
      plan: { action: "idempotent", leadId: args.idempotentLeadId, googleAdsCall },
    };
  }

  const mapped = mapHeardAboutToLeadSource({
    heardAbout: args.intake.heardAbout,
    otherText: args.intake.heardAboutOther,
    googleAdsCallMatched: Boolean(googleAdsCall),
  });
  if (!mapped.ok) return mapped;

  if (args.intake.phone && args.existing) {
    const disposition = phoneIntakeDisposition({
      existingCreatedAt: args.existing.createdAt,
      now: args.intake.now,
    });
    if (disposition === "duplicate" || disposition === "existing") {
      return {
        ok: true,
        plan: { action: disposition, leadId: args.existing.id, googleAdsCall },
      };
    }
  }

  const metadata = deskEventMetadata({
    channel: args.intake.channel,
    heardAbout: args.intake.heardAbout,
    leadSource: mapped.leadSource,
    googleAdsCall,
  });
  const summary =
    args.intake.channel === "phone" ? "Desk phone lead recorded" : "Desk walk-in recorded";

  return {
    ok: true,
    plan: {
      action: "create",
      googleAdsCall,
      row: {
        name: args.intake.name,
        phone_e164: args.intake.phone,
        vehicle_year: args.intake.vehicleYear,
        vehicle_make: args.intake.vehicleMake,
        vehicle_model: args.intake.vehicleModel,
        symptoms: args.intake.concern,
        lead_source: mapped.leadSource,
        notes: composeDeskNotes({
          appointmentInterest: args.intake.appointmentInterest,
          notes: args.intake.notes,
          now: args.intake.now,
        }),
        lifecycle: "New",
        intake_path: "desk",
        intake_channel: args.intake.channel,
        created_by: args.intake.staffUserId,
        heard_about: args.intake.heardAbout,
        appointment_interest: args.intake.appointmentInterest,
        desk_idempotency_key: args.intake.idempotencyKey,
        google_ads_call_id: googleAdsCall?.id ?? null,
      },
      event: {
        event_type: "desk_intake",
        actor: args.actor,
        summary,
        metadata,
      },
    },
  };
}

export function deskLifecycleChoices(from: Lifecycle): Lifecycle[] {
  return LIFECYCLE_VALUES.filter(
    (to) =>
      to !== from && to !== "Paid" && isAllowedLifecycleTransition({ from, to, actor: "staff" }),
  );
}

export function deskTransitionEvidence(to: Lifecycle): {
  basis: LifecycleEvidenceBasis;
  evidenceRef?: string;
} {
  if (to === "Appointment Scheduled") {
    return { basis: "appointment_record", evidenceRef: "desk-appointment" };
  }
  if (to === "Inspected") {
    return { basis: "inspection_record", evidenceRef: "desk-inspection" };
  }
  if (to === "Estimate Sent") {
    return { basis: "estimate_record", evidenceRef: "desk-estimate" };
  }
  if (to === "Approved") {
    return { basis: "estimate_record", evidenceRef: "desk-approval" };
  }
  return { basis: "staff_observation" };
}

export type DeskSearchPlan = {
  phoneExact: string | null;
  text: string | null;
  phoneDigits: string | null;
};

export function deskSearchPlan(raw: string): DeskSearchPlan {
  const trimmed = raw.trim().slice(0, 80);
  if (!trimmed) return { phoneExact: null, text: null, phoneDigits: null };
  const phoneExact = toDeskE164(trimmed);
  if (phoneExact) return { phoneExact, text: null, phoneDigits: null };
  const text = trimmed
    .replace(/[%_\\()",]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const digits = trimmed.replace(/\D/g, "");
  const phoneDigits = digits.length >= 4 && digits.length <= 15 ? digits : null;
  return { phoneExact: null, text: text || null, phoneDigits };
}

const SEARCH_TEXT_COLUMNS = [
  "name",
  "vehicle_make",
  "vehicle_model",
  "symptoms",
  "lead_source",
] as const;

export function deskSearchOr(plan: DeskSearchPlan): string | null {
  if (plan.phoneExact) return null;
  const parts: string[] = [];
  if (plan.text) {
    for (const column of SEARCH_TEXT_COLUMNS) {
      parts.push(`${column}.ilike."%${plan.text}%"`);
    }
  }
  if (plan.phoneDigits) parts.push(`phone_e164.ilike."%${plan.phoneDigits}%"`);
  return parts.length > 0 ? parts.join(",") : null;
}

export const DESK_LEAD_LIST_COLUMNS =
  "id, name, phone_e164, vehicle_year, vehicle_make, vehicle_model, symptoms, lead_source, heard_about, lifecycle, intake_path, intake_channel, created_at, square_gross_cents, square_paid_at, notes, google_ads_call_id, appointment_at, appointment_interest" as const;

export type DeskLeadCard = {
  id: string;
  name: string | null;
  phone: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  concern: string | null;
  leadSource: string | null;
  heardAbout: string | null;
  lifecycle: string;
  intakePath: string | null;
  intakeChannel: string | null;
  createdAt: string;
  squareGrossCents: number;
  squarePaidAt: string | null;
  notes: string | null;
  googleAdsCallId: string | null;
  appointmentAt: string | null;
  appointmentInterest: boolean;
};

export function toDeskLeadCard(row: {
  id: string;
  name: string | null;
  phone_e164: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  symptoms: string | null;
  lead_source: string | null;
  heard_about: string | null;
  lifecycle: string;
  intake_path: string | null;
  intake_channel: string | null;
  created_at: string;
  square_gross_cents: number;
  square_paid_at: string | null;
  notes: string | null;
  google_ads_call_id: string | null;
  appointment_at?: string | null;
  appointment_interest?: boolean;
}): DeskLeadCard {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone_e164,
    vehicleYear: row.vehicle_year,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    concern: row.symptoms,
    leadSource: row.lead_source,
    heardAbout: row.heard_about,
    lifecycle: row.lifecycle,
    intakePath: row.intake_path,
    intakeChannel: row.intake_channel,
    createdAt: row.created_at,
    squareGrossCents: row.square_gross_cents,
    squarePaidAt: row.square_paid_at,
    notes: row.notes,
    googleAdsCallId: row.google_ads_call_id,
    appointmentAt: row.appointment_at ?? null,
    appointmentInterest: row.appointment_interest ?? false,
  };
}

export function attributionUpdate(args: {
  currentSource: string | null;
  heardAbout: DeskHeardAbout;
  otherText: string | null;
  googleAdsCallMatched: boolean;
  confirm: boolean;
}): { ok: true; leadSource: string; heardAbout: DeskHeardAbout } | { ok: false; reason: string } {
  const mapped = mapHeardAboutToLeadSource({
    heardAbout: args.heardAbout,
    otherText: args.otherText,
    googleAdsCallMatched: args.googleAdsCallMatched,
  });
  if (!mapped.ok) return mapped;
  const sourceSet = Boolean(args.currentSource?.trim());
  const sameSource = args.currentSource === mapped.leadSource;
  if (sourceSet && !sameSource && !args.confirm) {
    return {
      ok: false,
      reason: "This lead already has a source. Confirm to correct it.",
    };
  }
  return { ok: true, leadSource: mapped.leadSource, heardAbout: args.heardAbout };
}

/** Link a known Ads call. Upgrade source only when it is blank or organic Google. */
export function attachAdsCallDecision(args: {
  currentSource: string | null;
  match: AdsCallLink | null;
}):
  | { ok: false; reason: string }
  | {
      ok: true;
      callId: string;
      leadSource: string | null;
      heardAbout: DeskHeardAbout | null;
    } {
  if (!args.match) {
    return { ok: false, reason: "No recent Google Ads call matches this phone" };
  }
  const upgrade = !args.currentSource?.trim() || args.currentSource === "Google Business Profile";
  return {
    ok: true,
    callId: args.match.id,
    leadSource: upgrade ? "Google Ads" : null,
    heardAbout: upgrade ? "google" : null,
  };
}

export function deskAdsLinkEvent(
  actor: string,
  weekStart: string,
): {
  event_type: "desk_ads_call_linked";
  actor: string;
  summary: string;
  metadata: { google_ads_call_linked: true; week_start: string };
} {
  return {
    event_type: "desk_ads_call_linked",
    actor,
    summary: "Desk linked a Google Ads call",
    metadata: { google_ads_call_linked: true, week_start: weekStart },
  };
}
