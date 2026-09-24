// Pure Meta Lead Ads parsing + normalization. No I/O, so it is unit-testable.

export type MetaPlatform = "facebook" | "instagram";

export const META_LEAD_SOURCE: Record<MetaPlatform, string> = {
  facebook: "Facebook Lead Ads",
  instagram: "Instagram Lead Ads",
};

export type MetaFieldDatum = { name: string; values?: string[] };

/** Subset of the Graph `Lead` node this integration reads. */
export type GraphLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  field_data?: MetaFieldDatum[];
  custom_disclaimer_responses?: { checkbox_key?: string; is_checked?: string | boolean }[];
  is_organic?: boolean;
  platform?: string;
};

export type GraphLeadForm = {
  id: string;
  name?: string;
  status?: string;
  locale?: string;
  privacy_policy_url?: string;
  legal_content?: {
    id?: string;
    privacy_policy?: { url?: string; link_text?: string };
    custom_disclaimer?: {
      title?: string;
      body?: { text?: string };
      checkboxes?: {
        key?: string;
        is_required?: boolean;
        is_checked_by_default?: boolean;
        checkbox_text?: string;
      }[];
    };
  };
};

export type LeadgenEvent = {
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  adId: string | null;
  adgroupId: string | null;
  createdTime: string | null;
};

type WebhookBody = {
  object?: string;
  entry?: {
    id?: string;
    time?: number;
    changes?: {
      field?: string;
      value?: {
        leadgen_id?: string | number;
        page_id?: string | number;
        form_id?: string | number;
        ad_id?: string | number;
        adgroup_id?: string | number;
        created_time?: number | string;
      };
    }[];
  }[];
};

function idOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function unixToIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Extracts every Page `leadgen` change from a webhook delivery (Meta batches entries). */
export function parseLeadgenEvents(body: unknown): LeadgenEvent[] {
  const payload = body as WebhookBody;
  if (!payload || payload.object !== "page" || !Array.isArray(payload.entry)) return [];
  const events: LeadgenEvent[] = [];
  const seen = new Set<string>();
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const leadgenId = idOrNull(change.value?.leadgen_id);
      if (!leadgenId || seen.has(leadgenId)) continue;
      seen.add(leadgenId);
      events.push({
        leadgenId,
        pageId: idOrNull(change.value?.page_id) ?? idOrNull(entry.id),
        formId: idOrNull(change.value?.form_id),
        adId: idOrNull(change.value?.ad_id),
        adgroupId: idOrNull(change.value?.adgroup_id),
        createdTime: unixToIso(change.value?.created_time),
      });
    }
  }
  return events;
}

/** Graph reports `fb` / `ig`; anything else defaults to Facebook. */
export function resolvePlatform(raw: string | undefined | null): MetaPlatform {
  const value = (raw ?? "").toLowerCase();
  return value === "ig" || value === "instagram" ? "instagram" : "facebook";
}

/** E.164 or null. Mirrors the leads.phone_e164 CHECK constraint. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else e164 = `+${digits}`;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

export type NormalizedMetaLead = {
  name: string | null;
  phone_e164: string | null;
  phone_raw: string | null;
  email: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_mileage: number | null;
  vin: string | null;
  symptoms: string | null;
  zip_code: string | null;
  /** Answers that did not map onto a lead column, kept as readable Q/A lines. */
  other_answers: { question: string; answer: string }[];
};

function words(key: string): string {
  return key
    .toLowerCase()
    .replace(/[_\-?.,:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(value: string): number | null {
  const match = /\b(19[0-9]{2}|20[0-9]{2}|2100)\b/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2100 ? year : null;
}

function parseMileage(value: string): number | null {
  const cleaned = value.toLowerCase().replace(/,/g, "").trim();
  const match = /(\d+(?:\.\d+)?)\s*(k)?/.exec(cleaned);
  if (!match) return null;
  const n = Math.round(Number(match[1]) * (match[2] ? 1000 : 1));
  return Number.isFinite(n) && n >= 0 && n <= 2_000_000 ? n : null;
}

/** "2014 Honda Accord" → year/make/model. */
function parseVehicleCombo(value: string): {
  year: number | null;
  make: string | null;
  model: string | null;
} {
  const year = parseYear(value);
  const rest = value
    .replace(/\b(19|20)\d{2}\b/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    year,
    make: rest[0] ?? null,
    model: rest.length > 1 ? rest.slice(1).join(" ") : null,
  };
}

const clip = (value: string, max: number) => value.slice(0, max);

/**
 * Maps Instant Form answers onto the Boltz lead model. Standard Meta keys
 * (full_name, phone_number, email, …) map exactly; custom questions map by
 * keyword. Nothing is discarded: unmatched answers land in other_answers and
 * the caller also stores the untouched field_data.
 */
export function normalizeFieldData(fieldData: MetaFieldDatum[] | undefined): NormalizedMetaLead {
  const out: NormalizedMetaLead = {
    name: null,
    phone_e164: null,
    phone_raw: null,
    email: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    vehicle_mileage: null,
    vin: null,
    symptoms: null,
    zip_code: null,
    other_answers: [],
  };
  let firstName: string | null = null;
  let lastName: string | null = null;
  const symptomParts: string[] = [];

  for (const field of fieldData ?? []) {
    const key = field.name ?? "";
    const value = (field.values ?? [])
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(", ");
    if (!key || !value) continue;
    const w = words(key);

    if (key === "full_name" || w === "name") out.name = clip(value, 200);
    else if (key === "first_name") firstName = value;
    else if (key === "last_name") lastName = value;
    else if (key === "phone_number" || key === "phone" || /\bphone\b/.test(w)) {
      // First phone wins (phone_number precedes work_phone_number on Meta forms).
      if (out.phone_raw) out.other_answers.push({ question: key, answer: value });
      else {
        out.phone_raw = value;
        out.phone_e164 = normalizePhone(value);
      }
    } else if (key === "email" || /\be ?mail\b/.test(w)) {
      out.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? clip(value.toLowerCase(), 320) : null;
      if (!out.email) out.other_answers.push({ question: key, answer: value });
    } else if (key === "zip_code" || key === "post_code" || /\b(zip|postal)\b/.test(w)) {
      out.zip_code = clip(value, 20);
    } else if (/\bvin\b/.test(w)) out.vin = clip(value.toUpperCase(), 32);
    else if (/\b(mileage|miles|odometer)\b/.test(w)) {
      out.vehicle_mileage = parseMileage(value);
      if (out.vehicle_mileage === null) out.other_answers.push({ question: key, answer: value });
    } else if (/\byear\b/.test(w) && /\bmake\b|\bmodel\b/.test(w)) {
      const combo = parseVehicleCombo(value);
      out.vehicle_year = combo.year ?? out.vehicle_year;
      out.vehicle_make = combo.make ? clip(combo.make, 100) : out.vehicle_make;
      out.vehicle_model = combo.model ? clip(combo.model, 100) : out.vehicle_model;
    } else if (/\byear\b/.test(w)) {
      out.vehicle_year = parseYear(value);
      if (out.vehicle_year === null) out.other_answers.push({ question: key, answer: value });
    } else if (/\bmake\b/.test(w) && !/\bmodel\b/.test(w)) out.vehicle_make = clip(value, 100);
    else if (/\bmodel\b/.test(w) && !/\bmake\b/.test(w)) out.vehicle_model = clip(value, 100);
    else if (/\b(vehicle|car|truck)\b/.test(w) && parseYear(value) !== null) {
      const combo = parseVehicleCombo(value);
      out.vehicle_year = combo.year;
      out.vehicle_make = combo.make ? clip(combo.make, 100) : null;
      out.vehicle_model = combo.model ? clip(combo.model, 100) : null;
    } else if (
      /\b(symptom|symptoms|problem|issue|issues|describe|service|repair|concern|wrong|help)\b/.test(
        w,
      )
    ) {
      symptomParts.push(value);
    } else {
      out.other_answers.push({ question: key, answer: clip(value, 500) });
    }
  }

  if (!out.name && (firstName || lastName)) {
    out.name = clip([firstName, lastName].filter(Boolean).join(" "), 200);
  }
  if (symptomParts.length > 0) out.symptoms = clip(symptomParts.join("\n"), 2000);
  return out;
}

export type MetaConsentEvidence = {
  source: string;
  basis: "web_form";
  form_id: string | null;
  form_name: string | null;
  meta_lead_id: string;
  captured_at: string;
  privacy_policy_url: string | null;
  disclaimer_title: string | null;
  checkboxes: {
    key: string | null;
    text: string | null;
    required: boolean | null;
    checked_by_default: boolean | null;
    checked: boolean;
  }[];
  sms_consent_checkbox_checked: boolean;
};

function isChecked(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  return value === "1" || value?.toLowerCase() === "true";
}

const SMS_CONSENT_TEXT = /\b(text|texts|texting|sms|message|messages)\b/i;

/**
 * Consent is recorded as evidence, never assumed. A lead counts as SMS
 * opted-in only when the form carried a custom-disclaimer checkbox whose
 * wording is about texts/SMS and the lead actually checked it.
 */
export function buildConsentEvidence(args: {
  lead: GraphLead;
  form: GraphLeadForm | null;
  platform: MetaPlatform;
  nowIso: string;
}): { evidence: MetaConsentEvidence; consentText: string | null; smsOptIn: boolean } {
  const disclaimer = args.form?.legal_content?.custom_disclaimer;
  const responses = new Map(
    (args.lead.custom_disclaimer_responses ?? []).map((r) => [
      r.checkbox_key ?? "",
      isChecked(r.is_checked),
    ]),
  );
  const checkboxes = (disclaimer?.checkboxes ?? []).map((box) => ({
    key: box.key ?? null,
    text: box.checkbox_text ?? null,
    required: box.is_required ?? null,
    checked_by_default: box.is_checked_by_default ?? null,
    checked: responses.get(box.key ?? "") ?? false,
  }));
  // Responses for checkboxes the form snapshot did not describe are still evidence.
  for (const [key, checked] of responses) {
    if (!checkboxes.some((c) => c.key === key)) {
      checkboxes.push({ key, text: null, required: null, checked_by_default: null, checked });
    }
  }
  const smsOptIn = checkboxes.some(
    (c) => c.checked && SMS_CONSENT_TEXT.test(`${c.text ?? ""} ${c.key ?? ""}`),
  );

  const textParts = [
    disclaimer?.title,
    disclaimer?.body?.text,
    ...(disclaimer?.checkboxes ?? []).map((b) => b.checkbox_text),
  ].filter((p): p is string => Boolean(p && p.trim()));

  return {
    evidence: {
      source: META_LEAD_SOURCE[args.platform],
      basis: "web_form",
      form_id: args.form?.id ?? args.lead.form_id ?? null,
      form_name: args.form?.name ?? null,
      meta_lead_id: args.lead.id,
      captured_at: args.nowIso,
      privacy_policy_url:
        args.form?.legal_content?.privacy_policy?.url ?? args.form?.privacy_policy_url ?? null,
      disclaimer_title: disclaimer?.title ?? null,
      checkboxes,
      sms_consent_checkbox_checked: smsOptIn,
    },
    consentText: textParts.length > 0 ? textParts.join("\n") : null,
    smsOptIn,
  };
}

/** Lead-column updates that only fill blanks, so ingestion never clobbers staff edits. */
export function fillBlankLeadFields(
  existing: Record<string, unknown>,
  normalized: NormalizedMetaLead,
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    name: normalized.name,
    email: normalized.email,
    vehicle_year: normalized.vehicle_year,
    vehicle_make: normalized.vehicle_make,
    vehicle_model: normalized.vehicle_model,
    vehicle_mileage: normalized.vehicle_mileage,
    vin: normalized.vin,
    symptoms: normalized.symptoms,
  };
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === null || value === undefined || value === "") continue;
    const current = existing[key];
    if (current === null || current === undefined || current === "") updates[key] = value;
  }
  return updates;
}

/** Plain-text summary of the form submission for staff notes and the Grok prompt. */
export function formSummary(normalized: NormalizedMetaLead, formName: string | null): string {
  const lines = [`Meta Instant Form${formName ? ` "${formName}"` : ""} submission:`];
  const vehicle = [normalized.vehicle_year, normalized.vehicle_make, normalized.vehicle_model]
    .filter(Boolean)
    .join(" ");
  if (normalized.name) lines.push(`Name: ${normalized.name}`);
  if (vehicle) lines.push(`Vehicle: ${vehicle}`);
  if (normalized.vehicle_mileage !== null) lines.push(`Mileage: ${normalized.vehicle_mileage}`);
  if (normalized.symptoms) lines.push(`Described issue: ${normalized.symptoms}`);
  if (normalized.zip_code) lines.push(`ZIP: ${normalized.zip_code}`);
  for (const qa of normalized.other_answers) lines.push(`${qa.question}: ${qa.answer}`);
  return lines.join("\n").slice(0, 2000);
}
