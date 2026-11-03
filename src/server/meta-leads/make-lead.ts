// Make.com "Facebook Lead Ads > Watch New Leads" payload → the Meta lead model.
// Pure aside from reading MAKE_LEAD_INTAKE_SECRET. No Graph calls.
import { secretEqual } from "../lead-inbox/env.server.ts";
import type { GraphLead, GraphLeadForm, MetaFieldDatum } from "./normalize.ts";

export type InboundMetaLead = {
  metaLeadId: string;
  /** True when the email had contact details but no Meta lead id. */
  syntheticId: boolean;
  createdTime: string | null;
  pageId: string | null;
  formId: string | null;
  formName: string | null;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  platform: string | null;
  isOrganic: boolean | null;
  fieldData: MetaFieldDatum[];
  disclaimerResponses: NonNullable<GraphLead["custom_disclaimer_responses"]>;
};

export type ParsedMakeLead = { ok: true; lead: InboundMetaLead } | { ok: false; error: string };

const ID_RE = /^[A-Za-z0-9:_-]{1,80}$/;

const RESERVED = new Set([
  "id",
  "lead_id",
  "leadgen_id",
  "leadid",
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
  "partner_name",
  "retailer_item_id",
]);

/** Presence only. Trims. Never log the return value. */
export function readMakeLeadIntakeSecret(): string | undefined {
  const value = process.env["MAKE_LEAD_INTAKE_SECRET"];
  if (value && value.trim().length > 0) return value.trim();
  return undefined;
}

/**
 * `Authorization: Bearer <MAKE_LEAD_INTAKE_SECRET>`.
 * 503 when the env var is unset, 401 for anything else that does not match.
 * Comparison hashes both sides, so length and a shared prefix are not leaked.
 */
export function authorizeMakeLeadIntake(
  authorizationHeader: string | null,
  secret: string | undefined,
): Response | null {
  if (!secret) {
    return Response.json({ error: "Make intake is not configured" }, { status: 503 });
  }
  const header = authorizationHeader ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !secretEqual(token, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function parseMakeLeadBody(body: unknown): ParsedMakeLead {
  if (Array.isArray(body)) {
    if (body.length === 1) return parseMakeLeadBody(body[0]);
    return { ok: false, error: "Invalid request body" };
  }
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body" };
  const record = body as Record<string, unknown>;

  const rawId =
    pick(record, ["id", "lead_id", "leadgen_id", "leadId"]) ?? nested(record["lead"]).id;
  const metaLeadId = normalizeLeadId(rawId);
  if (!metaLeadId) return { ok: false, error: "lead id is required" };

  const fieldData = fieldDataFromBody(record);
  if (fieldData.length === 0) return { ok: false, error: "field_data is required" };

  const formBits = nested(record["form"]);
  const adBits = nested(record["ad"]);
  const campaignBits = nested(record["campaign"]);
  const pageBits = nested(record["page"]);
  const adsetBits = nested(record["adset"]);

  return {
    ok: true,
    lead: {
      metaLeadId,
      syntheticId: metaLeadId.startsWith("email:"),
      createdTime: parseMetaTime(pick(record, ["created_time", "createdTime", "time_created"])),
      pageId: normalizeLeadId(pick(record, ["page_id", "pageId"]) ?? pageBits.id),
      formId: normalizeLeadId(pick(record, ["form_id", "formId"]) ?? formBits.id),
      formName: clip(pick(record, ["form_name", "formName"]) ?? formBits.name, 200),
      adId: normalizeLeadId(pick(record, ["ad_id", "adId"]) ?? adBits.id),
      adName: clip(pick(record, ["ad_name", "adName"]) ?? adBits.name, 200),
      adsetId: normalizeLeadId(
        pick(record, ["adset_id", "adsetId", "adgroup_id", "adgroupId"]) ?? adsetBits.id,
      ),
      adsetName: clip(pick(record, ["adset_name", "adsetName"]) ?? adsetBits.name, 200),
      campaignId: normalizeLeadId(pick(record, ["campaign_id", "campaignId"]) ?? campaignBits.id),
      campaignName: clip(pick(record, ["campaign_name", "campaignName"]) ?? campaignBits.name, 200),
      platform: clip(pick(record, ["platform"]), 32),
      isOrganic: parseBool(record["is_organic"] ?? record["isOrganic"]),
      fieldData,
      disclaimerResponses: parseDisclaimers(record["custom_disclaimer_responses"]),
    },
  };
}

export function graphPartsFromInbound(lead: InboundMetaLead): {
  lead: GraphLead;
  form: GraphLeadForm | null;
} {
  const graphLead: GraphLead = {
    id: lead.metaLeadId,
    field_data: lead.fieldData,
  };
  if (lead.createdTime) graphLead.created_time = lead.createdTime;
  if (lead.adId) graphLead.ad_id = lead.adId;
  if (lead.adName) graphLead.ad_name = lead.adName;
  if (lead.adsetId) graphLead.adset_id = lead.adsetId;
  if (lead.adsetName) graphLead.adset_name = lead.adsetName;
  if (lead.campaignId) graphLead.campaign_id = lead.campaignId;
  if (lead.campaignName) graphLead.campaign_name = lead.campaignName;
  if (lead.formId) graphLead.form_id = lead.formId;
  if (lead.platform) graphLead.platform = lead.platform;
  if (lead.isOrganic !== null) graphLead.is_organic = lead.isOrganic;
  if (lead.disclaimerResponses.length > 0) {
    graphLead.custom_disclaimer_responses = lead.disclaimerResponses;
  }
  const form: GraphLeadForm | null = lead.formId
    ? lead.formName
      ? { id: lead.formId, name: lead.formName }
      : { id: lead.formId }
    : lead.formName
      ? { id: "payload", name: lead.formName }
      : null;
  return { lead: graphLead, form };
}

export function parseMetaTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = stringValue(value);
  if (!text) return null;
  if (/^\d{10,13}$/.test(text)) {
    const n = Number(text);
    const ms = text.length >= 13 ? n : n * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function normalizeLeadId(value: string | null): string | null {
  if (!value) return null;
  const stripped = value.trim().replace(/^l:/i, "");
  return ID_RE.test(stripped) ? stripped : null;
}

function fieldDataFromBody(record: Record<string, unknown>): MetaFieldDatum[] {
  const structured = parseFieldData(record["field_data"] ?? record["fieldData"]);
  if (structured.length > 0) return structured;
  return flattenedFields(record);
}

function parseFieldData(value: unknown): MetaFieldDatum[] {
  let parsed = value;
  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    const out: MetaFieldDatum[] = [];
    for (const item of parsed.slice(0, 40)) {
      const datum = datumFromUnknown(item);
      if (datum) out.push(datum);
    }
    return out;
  }
  if (parsed && typeof parsed === "object")
    return flattenedFields(parsed as Record<string, unknown>);
  return [];
}

function datumFromUnknown(item: unknown): MetaFieldDatum | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const rec = item as Record<string, unknown>;
  const name = stringValue(rec["name"]) ?? stringValue(rec["key"]);
  if (!name) return null;
  const values = valueList(rec["values"] ?? rec["value"]);
  if (values.length === 0) return null;
  return { name: name.slice(0, 200), values };
}

function flattenedFields(record: Record<string, unknown>): MetaFieldDatum[] {
  const out: MetaFieldDatum[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (RESERVED.has(key.toLowerCase().replace(/[\s-]+/g, "_"))) continue;
    const values = valueList(value);
    if (values.length === 0) continue;
    out.push({ name: key.slice(0, 200), values });
    if (out.length >= 40) break;
  }
  return out;
}

function valueList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item))
      .filter((item): item is string => Boolean(item))
      .map((item) => item.slice(0, 2000))
      .slice(0, 10);
  }
  const one = stringValue(value);
  return one ? [one.slice(0, 2000)] : [];
}

function parseDisclaimers(value: unknown): NonNullable<GraphLead["custom_disclaimer_responses"]> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<GraphLead["custom_disclaimer_responses"]> = [];
  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const key = stringValue(rec["checkbox_key"]) ?? stringValue(rec["key"]);
    if (!key) continue;
    const checked = rec["is_checked"];
    if (typeof checked !== "boolean" && typeof checked !== "string") continue;
    out.push({ checkbox_key: key.slice(0, 80), is_checked: checked });
  }
  return out;
}

function nested(value: unknown): { id: string | null; name: string | null } {
  if (typeof value === "string" || typeof value === "number") {
    const text = stringValue(value);
    if (!text) return { id: null, name: null };
    if (/^\d{5,}$/.test(text)) return { id: text, name: null };
    return { id: null, name: text };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { id: null, name: null };
  const rec = value as Record<string, unknown>;
  return {
    id: stringValue(rec["id"]) ?? stringValue(rec["Id"]),
    name: stringValue(rec["name"]) ?? stringValue(rec["Name"]),
  };
}

function pick(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  return null;
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.slice(0, max);
}
