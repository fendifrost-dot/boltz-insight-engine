// Make.com "Facebook Lead Ads > Watch New Leads" body → Graph lead shape.
// No I/O and no call to graph.facebook.com. Lead ids must be strings when
// they are larger than a safe integer; a rounded number is rejected.
import type { GraphLead, MetaFieldDatum } from "./normalize.ts";

export type ParsedMakeLead = {
  metaLeadId: string;
  pageId: string | null;
  formName: string | null;
  lead: GraphLead;
};

const RESERVED = new Set([
  "id",
  "lead_id",
  "leadid",
  "leadgen_id",
  "leadgenid",
  "created_time",
  "createdtime",
  "time_created",
  "page_id",
  "pageid",
  "page",
  "form_id",
  "formid",
  "form_name",
  "formname",
  "form",
  "ad_id",
  "adid",
  "ad_name",
  "adname",
  "ad",
  "adset_id",
  "adsetid",
  "adset_name",
  "adsetname",
  "adset",
  "adgroup_id",
  "adgroupid",
  "campaign_id",
  "campaignid",
  "campaign_name",
  "campaignname",
  "campaign",
  "platform",
  "is_organic",
  "isorganic",
  "field_data",
  "fielddata",
  "custom_disclaimer_responses",
  "customdisclaimeresponses",
]);

const LEAD_ID_KEYS = ["id", "lead_id", "leadgen_id", "leadgenId", "leadId"] as const;

export function parseMakeLeadPayload(body: unknown): ParsedMakeLead | { error: string } {
  const record = unwrap(body);
  if (!record) return { error: "Invalid request body" };
  const idResult = readLeadId(record);
  if ("error" in idResult) return idResult;

  const pageId = readPageId(record);
  const form = readNamed(record, "form", "form_id", "form_name");
  const ad = readNamed(record, "ad", "ad_id", "ad_name");
  const adset = asRecord(at(record, "adset"));
  const adsetId =
    readId(at(record, "adset_id")) ??
    readId(at(record, "adgroup_id")) ??
    (adset ? readId(at(adset, "id")) : null);
  const adsetName = text(at(record, "adset_name")) ?? (adset ? text(at(adset, "name")) : null);
  const campaign = readNamed(record, "campaign", "campaign_id", "campaign_name");
  const fieldData = mergeFields(
    readFieldData(at(record, "field_data") ?? at(record, "fielddata")),
    flattenedFields(record),
  );
  const created = toIso(
    at(record, "created_time") ?? at(record, "createdtime") ?? at(record, "time_created"),
  );
  const platform = text(at(record, "platform"));
  const organic = asBool(at(record, "is_organic") ?? at(record, "isorganic"));
  const disclaimers = readDisclaimers(
    at(record, "custom_disclaimer_responses") ?? at(record, "customdisclaimeresponses"),
  );

  return {
    metaLeadId: idResult.id,
    pageId,
    formName: form.name,
    lead: {
      id: idResult.id,
      ...(created ? { created_time: created } : {}),
      ...(ad.id ? { ad_id: ad.id } : {}),
      ...(ad.name ? { ad_name: ad.name } : {}),
      ...(adsetId ? { adset_id: adsetId } : {}),
      ...(adsetName ? { adset_name: adsetName } : {}),
      ...(campaign.id ? { campaign_id: campaign.id } : {}),
      ...(campaign.name ? { campaign_name: campaign.name } : {}),
      ...(form.id ? { form_id: form.id } : {}),
      field_data: fieldData,
      ...(disclaimers ? { custom_disclaimer_responses: disclaimers } : {}),
      ...(organic !== undefined ? { is_organic: organic } : {}),
      ...(platform ? { platform } : {}),
    },
  };
}

function at(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function unwrap(body: unknown): Record<string, unknown> | null {
  const record = asRecord(body);
  if (!record) return null;
  if (hasLeadKey(record)) return record;
  for (const key of ["lead", "data", "body"]) {
    const inner = asRecord(record[key]);
    if (inner && hasLeadKey(inner)) return inner;
  }
  return record;
}

function hasLeadKey(record: Record<string, unknown>): boolean {
  return LEAD_ID_KEYS.some(
    (key) => record[key] !== undefined && record[key] !== null && record[key] !== "",
  );
}

function readLeadId(record: Record<string, unknown>): { id: string } | { error: string } {
  let saw = false;
  for (const key of LEAD_ID_KEYS) {
    if (!(key in record) || record[key] === null || record[key] === "") continue;
    saw = true;
    const value = record[key];
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) {
      return { error: "lead id must be sent as a string" };
    }
    const id = readId(value);
    if (id) return { id };
  }
  return { error: saw ? "lead id is not valid" : "lead id is required" };
}

function readPageId(record: Record<string, unknown>): string | null {
  const page = at(record, "page");
  const nested = asRecord(page);
  return (
    readId(at(record, "page_id")) ??
    readId(at(record, "pageid")) ??
    (nested ? readId(at(nested, "id")) : null) ??
    (typeof page === "string" ? readId(page) : null)
  );
}

function readNamed(
  record: Record<string, unknown>,
  nestedKey: string,
  idKey: string,
  nameKey: string,
): { id: string | null; name: string | null } {
  const nested = asRecord(record[nestedKey]);
  const id = readId(record[idKey]) ?? (nested ? readId(at(nested, "id")) : null);
  const name =
    text(record[nameKey]) ??
    (nested ? text(at(nested, "name")) : null) ??
    (typeof record[nestedKey] === "string" && !readId(record[nestedKey])
      ? text(record[nestedKey])
      : null);
  return { id, name };
}

/** Numeric Meta ids only. Unsafe JSON numbers are not coerced. */
function readId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^[0-9]{8,32}$/.test(trimmed) ? trimmed : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 10_000_000) {
    return String(value);
  }
  return null;
}

function readFieldData(value: unknown): MetaFieldDatum[] {
  if (Array.isArray(value)) {
    const out: MetaFieldDatum[] = [];
    for (const item of value) {
      const row = asRecord(item);
      if (!row) continue;
      const name = text(at(row, "name"));
      if (!name) continue;
      out.push({ name: clip(name, 200), values: readValues(at(row, "values")) });
    }
    return out;
  }
  const record = asRecord(value);
  return record ? flattenedFrom(record, false) : [];
}

function flattenedFields(record: Record<string, unknown>): MetaFieldDatum[] {
  return flattenedFrom(record, true);
}

function flattenedFrom(record: Record<string, unknown>, skipReserved: boolean): MetaFieldDatum[] {
  const out: MetaFieldDatum[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (skipReserved && RESERVED.has(key.toLowerCase().replace(/[\s-]+/g, ""))) continue;
    const name = text(key);
    if (!name) continue;
    const values = readValues(value);
    if (values.length === 0) continue;
    out.push({ name: clip(name, 200), values });
  }
  return out;
}

function mergeFields(primary: MetaFieldDatum[], extra: MetaFieldDatum[]): MetaFieldDatum[] {
  const seen = new Set(primary.map((field) => field.name));
  const merged = [...primary];
  for (const field of extra) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    merged.push(field);
  }
  return merged.slice(0, 80);
}

function readValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => scalar(item)).slice(0, 20);
  return scalar(value);
}

function scalar(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [clip(trimmed, 2000)] : [];
  }
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (typeof value === "boolean") return [value ? "true" : "false"];
  return [];
}

function readDisclaimers(value: unknown): GraphLead["custom_disclaimer_responses"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { checkbox_key?: string; is_checked?: string | boolean }[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const checked = at(row, "is_checked");
    if (typeof checked !== "boolean" && typeof checked !== "string") continue;
    const key = text(at(row, "checkbox_key"));
    out.push(key ? { checkbox_key: key, is_checked: checked } : { is_checked: checked });
  }
  return out.length > 0 ? out.slice(0, 20) : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    const ms = raw.length >= 13 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function clip(value: string, max: number): string {
  return value.slice(0, max);
}
