// Meta lead-notification mail. Pure. Does not touch Yelp, Durable, or Google.
import type { InboundMetaLead } from "../meta-leads/make-lead.ts";
import { normalizeLeadId, parseMakeLeadBody, parseMetaTime } from "../meta-leads/make-lead.ts";

export type MetaLeadEmail =
  { kind: "ignore" } | { kind: "notice" } | { kind: "leads"; leads: InboundMetaLead[] };

const OFFICIAL_SENDER = /@(facebookmail\.com|metamail\.com|facebook\.com|fb\.com|meta\.com)$/i;

/** Agency-partner phishing uses facebookmail.com too. It is not a lead notice. */
const NOT_A_LEAD =
  /agency partner|partner program|business portfolio|action required|advertising credit|password|invoice|security alert|confirm your email/i;

const LEAD_NOTICE =
  /you have (?:a )?new leads?\b|new leads?\b|view (?:this )?lead\b|instant form|lead ads|leads center|leads? (?:is|are) attached|your (?:new )?leads\b/i;

const CONTACT_HEADER = new Set([
  "email",
  "phone",
  "phone_number",
  "full_name",
  "name",
  "first_name",
  "last_name",
]);

const ATTR_HEADER: Record<string, string> = {
  id: "id",
  lead_id: "id",
  leadgen_id: "id",
  created_time: "created_time",
  created: "created_time",
  page_id: "page_id",
  form_id: "form_id",
  form_name: "form_name",
  form: "form_name",
  ad_id: "ad_id",
  ad_name: "ad_name",
  adset_id: "adset_id",
  adset_name: "adset_name",
  campaign_id: "campaign_id",
  campaign_name: "campaign_name",
  campaign: "campaign_name",
  platform: "platform",
  is_organic: "is_organic",
};

export function parseMetaLeadEmail(email: {
  from: string;
  subject: string;
  body: string;
  messageId: string;
  csvText?: string | null;
}): MetaLeadEmail {
  if (!isOfficialMetaSender(email.from)) return { kind: "ignore" };
  const haystack = `${email.subject}\n${email.body}`;
  const csvLeads = [
    ...leadsFromCsv(email.csvText ?? "", email.messageId),
    ...leadsFromCsv(looksLikeCsv(email.body) ? email.body : "", email.messageId),
  ];
  const deduped = dedupeLeads(csvLeads);
  if (deduped.length > 0) return { kind: "leads", leads: deduped };
  // Subject only. A form answer in the body must not hide a real lead.
  if (NOT_A_LEAD.test(email.subject)) return { kind: "ignore" };

  const inline = inlineLead(email.body, email.messageId);
  if (inline) return { kind: "leads", leads: [inline] };
  if (LEAD_NOTICE.test(haystack)) return { kind: "notice" };
  return { kind: "ignore" };
}

function isOfficialMetaSender(from: string): boolean {
  const addressed = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return OFFICIAL_SENDER.test(addressed.trim());
}

function inlineLead(body: string, messageId: string): InboundMetaLead | null {
  const email = customerEmail(labeled(body, ["Email", "Email address"]));
  const phone = labeled(body, ["Phone number", "Phone", "Mobile"]);
  if (!email && !phone) return null;
  const name = labeled(body, ["Full name", "Name"]);
  const leadId =
    normalizeLeadId(labeled(body, ["Lead ID", "Lead id", "Leadgen ID", "leadgen_id"])) ??
    syntheticId(messageId, 0);
  const created = parseMetaTime(labeled(body, ["Created time", "Created", "Date"]));
  const payload: Record<string, unknown> = {
    id: leadId,
    created_time: created,
    form_name: labeled(body, ["Form", "Form name"]),
    campaign_name: labeled(body, ["Campaign"]),
    ad_name: labeled(body, ["Ad", "Ad name"]),
    platform: labeled(body, ["Platform"]),
  };
  if (name) payload["full_name"] = name;
  if (email) payload["email"] = email;
  if (phone) payload["phone_number"] = phone;
  for (const qa of questionAnswers(body)) {
    if (!payload[qa.question]) payload[qa.question] = qa.answer;
  }
  const parsed = parseMakeLeadBody(payload);
  return parsed.ok ? parsed.lead : null;
}

function leadsFromCsv(text: string, messageId: string): InboundMetaLead[] {
  if (!text.trim() || !looksLikeCsv(text)) return [];
  const rows = splitCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!header.some((cell) => CONTACT_HEADER.has(cell))) return [];
  const leads: InboundMetaLead[] = [];
  for (const [index, row] of rows.slice(1, 101).entries()) {
    if (row.every((cell) => !cell.trim())) continue;
    const payload: Record<string, unknown> = {};
    header.forEach((key, column) => {
      const value = (row[column] ?? "").trim();
      if (!key || !value) return;
      const attr = ATTR_HEADER[key];
      if (attr) payload[attr] = attr === "id" ? value.replace(/^l:/i, "") : value;
      else if (!payload[key]) payload[key] = value;
    });
    if (!payload["id"]) payload["id"] = syntheticId(messageId, index);
    const parsed = parseMakeLeadBody(payload);
    if (parsed.ok) leads.push(parsed.lead);
  }
  return leads;
}

function dedupeLeads(leads: InboundMetaLead[]): InboundMetaLead[] {
  const seen = new Set<string>();
  const out: InboundMetaLead[] = [];
  for (const lead of leads) {
    if (seen.has(lead.metaLeadId)) continue;
    seen.add(lead.metaLeadId);
    out.push(lead);
  }
  return out;
}

function syntheticId(messageId: string, index: number): string {
  const safe = messageId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  const suffix = index === 0 ? "" : `:${index}`;
  return `email:${safe || "msg"}${suffix}`;
}

function looksLikeCsv(text: string): boolean {
  const first = text.trim().split(/\r?\n/, 1)[0] ?? "";
  return first.includes(",") && /email|phone|full_name|\bname\b/i.test(first);
}

/** The shop inbox and Meta's own addresses are not the lead. */
function customerEmail(value: string | null): string | null {
  if (!value) return null;
  if (/boltzautoinc\.com|facebookmail\.com|metamail\.com|@(facebook|meta|fb)\.com/i.test(value)) {
    return null;
  }
  return value;
}

function labeled(body: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sameLine = new RegExp(
      `(?:^|\\n)\\s*\\|?\\s*${escaped}\\s*(?:\\||:)\\s*([^\\n|]+)`,
      "i",
    ).exec(body);
    const nextLine = new RegExp(`(?:^|\\n)\\s*\\|?\\s*${escaped}\\s*\\n+\\s*([^\\n|]+)`, "i").exec(
      body,
    );
    const raw = sameLine?.[1] ?? nextLine?.[1] ?? null;
    if (!raw) continue;
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value || /^(view lead|download|see more|n\/a)$/i.test(value)) continue;
    return value.slice(0, 500);
  }
  return null;
}

function questionAnswers(body: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  const pattern = /(?:^|\n)\s*Question:\s*([^\n]+)\n+\s*Answer:\s*([^\n]+)/gi;
  for (const match of body.matchAll(pattern)) {
    const question = match[1]?.trim();
    const answer = match[2]?.trim();
    if (!question || !answer) continue;
    out.push({ question: question.slice(0, 200), answer: answer.slice(0, 2000) });
    if (out.length >= 20) break;
  }
  return out;
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
