// Meta lead-notification mail. Native notices do not carry form answers;
// a message that does is still parsed into field_data. Yelp, Durable, and
// Google mail are never matched here.
import type { MetaFieldDatum } from "../meta-leads/normalize.ts";
import type { InboundEmail } from "./parse-email.ts";

export type ParsedMetaEmail = {
  kind: "notice" | "details";
  metaLeadId: string | null;
  pageId: string | null;
  formId: string | null;
  formName: string | null;
  adId: string | null;
  adName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  platform: "facebook" | "instagram";
  fieldData: MetaFieldDatum[];
};

const NOT_A_LEAD =
  /password|security code|login code|confirm (?:your )?email|two-factor|verification code|ad (?:was )?approved|payment|billing|invoice|unusual login/i;
const LEAD_SIGNAL = /you have a new lead|\bnew lead\b|lead ads|instant form|leadgen/i;
const LEAD_ID_LABEL = /(?:leadgen[_\s-]?id|lead[_\s-]?id)\s*[:=]\s*(\d{12,20})/i;
const SKIP_LABEL =
  /^(view lead|view this lead|view in leads center|click here|thanks|thank you|hi|hello|facebook|the facebook team|instagram|meta|unsubscribe|privacy|learn more|questions)$/i;

/**
 * Mailbox dedupe key. A Meta lead id in the message wins so webhook, Make,
 * and reconcile share one row. Without one, the Gmail message id is the key.
 */
export function metaEmailDedupeId(parsed: ParsedMetaEmail, messageId: string): string {
  if (parsed.metaLeadId) return parsed.metaLeadId;
  const safe = messageId.replace(/[^\w.:@+-]/g, "").slice(0, 180);
  return `email:${safe || "unknown"}`;
}

export function parseMetaLeadEmail(email: InboundEmail): ParsedMetaEmail | null {
  if (!isMetaFrom(email.from)) return null;
  if (NOT_A_LEAD.test(email.subject)) return null;
  const blob = `${email.subject}\n${email.body}`;
  if (!LEAD_SIGNAL.test(blob)) return null;

  const textBody = visibleText(email.body);
  const ids = extractIds(`${email.subject}\n${textBody}`);
  const labeled = extractLabeled(textBody);
  const platform: ParsedMetaEmail["platform"] =
    /instagram/i.test(email.from) || /instagram/i.test(email.subject) ? "instagram" : "facebook";
  const fieldData = labeled.fieldData;
  const hasAnswers = fieldData.some((field) => (field.values ?? []).some((value) => value.trim()));

  return {
    kind: hasAnswers ? "details" : "notice",
    metaLeadId: labeled.metaLeadId ?? ids.leadId,
    pageId: labeled.pageId ?? ids.pageId,
    formId: labeled.formId ?? ids.formId,
    formName: labeled.formName,
    adId: labeled.adId ?? ids.adId,
    adName: labeled.adName,
    campaignId: labeled.campaignId ?? ids.campaignId,
    campaignName: labeled.campaignName,
    platform,
    fieldData,
  };
}

function isMetaFrom(from: string): boolean {
  const lower = from.toLowerCase();
  return (
    lower.includes("facebookmail.com") ||
    lower.includes("metamail.com") ||
    lower.includes("@facebook.com") ||
    lower.includes("@fb.com") ||
    lower.includes("@instagram.com") ||
    lower.includes("@meta.com") ||
    /@[a-z0-9.-]+\.(?:facebook|meta)\.com\b/.test(lower)
  );
}

function visibleText(body: string): string {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

type Labeled = {
  metaLeadId: string | null;
  pageId: string | null;
  formId: string | null;
  formName: string | null;
  adId: string | null;
  adName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  fieldData: MetaFieldDatum[];
};

function extractLabeled(body: string): Labeled {
  const out: Labeled = {
    metaLeadId: null,
    pageId: null,
    formId: null,
    formName: null,
    adId: null,
    adName: null,
    campaignId: null,
    campaignName: null,
    fieldData: [],
  };
  const lines = body
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const consumed = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    const split = /^([^|:]{1,120}?)\s*(?:\||:)\s*(.+)$/.exec(lines[i] ?? "");
    if (!split?.[1] || !split[2]) continue;
    const label = split[1].trim();
    const value = cleanValue(split[2]);
    if (!value || SKIP_LABEL.test(label) || /^https?$/i.test(label)) continue;
    consumed.add(i);
    applyLabel(out, label, value);
  }

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    const question = lines[i] ?? "";
    if (!question.endsWith("?") || question.length > 160) continue;
    const answer = cleanValue(lines[i + 1] ?? "");
    if (!answer || answer.endsWith("?")) continue;
    consumed.add(i);
    consumed.add(i + 1);
    pushField(out, question, answer);
  }
  return out;
}

function applyLabel(out: Labeled, label: string, value: string): void {
  const key = label.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(leadgen id|lead id)$/.test(key)) {
    const id = /^(\d{12,20})$/.exec(value.replace(/\s+/g, ""));
    if (id?.[1]) out.metaLeadId = id[1];
    return;
  }
  if (key === "page id" || key === "page") {
    const id = onlyDigits(value);
    if (id) out.pageId = id;
    return;
  }
  if (key === "form id") {
    const id = onlyDigits(value);
    if (id) out.formId = id;
    return;
  }
  if (key === "form" || key === "form name") {
    const id = onlyDigits(value);
    if (id && key !== "form name") out.formId = id;
    else out.formName = clip(value, 200);
    return;
  }
  if (key === "ad id") {
    const id = onlyDigits(value);
    if (id) out.adId = id;
    return;
  }
  if (key === "ad" || key === "ad name") {
    const id = onlyDigits(value);
    if (id && key !== "ad name") out.adId = id;
    else out.adName = clip(value, 200);
    return;
  }
  if (key === "campaign id") {
    const id = onlyDigits(value);
    if (id) out.campaignId = id;
    return;
  }
  if (key === "campaign" || key === "campaign name") {
    const id = onlyDigits(value);
    if (id && key !== "campaign name") out.campaignId = id;
    else out.campaignName = clip(value, 200);
    return;
  }
  const fieldName =
    key === "full name" || key === "name"
      ? "full_name"
      : key === "first name"
        ? "first_name"
        : key === "last name"
          ? "last_name"
          : key === "email" || key === "e mail" || key === "email address"
            ? "email"
            : key === "phone" ||
                key === "phone number" ||
                key === "mobile" ||
                key === "mobile number"
              ? "phone_number"
              : label;
  pushField(out, fieldName, value);
}

function pushField(out: Labeled, name: string, value: string): void {
  if (out.fieldData.length >= 80) return;
  if (out.fieldData.some((field) => field.name === name)) return;
  out.fieldData.push({ name: clip(name, 200), values: [clip(value, 2000)] });
}

function extractIds(text: string): {
  leadId: string | null;
  pageId: string | null;
  formId: string | null;
  adId: string | null;
  campaignId: string | null;
} {
  const fromQuery = (name: string) => {
    const match = new RegExp(`[?&]${name}=(\\d{12,20})`, "i").exec(text);
    return match?.[1] ?? null;
  };
  return {
    leadId: LEAD_ID_LABEL.exec(text)?.[1] ?? fromQuery("leadgen_id") ?? fromQuery("lead_id"),
    pageId: fromQuery("page_id"),
    formId: fromQuery("form_id"),
    adId: fromQuery("ad_id"),
    campaignId: fromQuery("campaign_id"),
  };
}

function cleanValue(raw: string): string | null {
  const value = raw
    .replace(/\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return null;
  if (/^(view lead|view this lead|click here)$/i.test(value)) return null;
  return value;
}

function onlyDigits(value: string): string | null {
  return /^\d{12,20}$/.test(value) ? value : null;
}

function clip(value: string, max: number): string {
  return value.slice(0, max);
}
