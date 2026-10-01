// Turns a lead-notification email into fields. Never logs the message.
import { detectOptOut } from "../lead-inbox/safety.server.ts";

export const EMAIL_LEAD_SOURCES = [
  "Yelp",
  "Durable website",
  "Google LSA",
  "Google Business Profile",
  "Google Ads",
] as const;

export type EmailLeadSource = (typeof EMAIL_LEAD_SOURCES)[number];

export type InboundEmail = {
  from: string;
  subject: string;
  body: string;
  messageId: string;
  receivedAt: string | null;
};

export type ParsedEmailLead = {
  source: EmailLeadSource;
  externalId: string;
  name: string | null;
  email: string | null;
  phoneRaw: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleMileage: number | null;
  symptoms: string | null;
  smsOptIn: boolean;
  customerOptOut: boolean;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function parseInboundEmail(email: InboundEmail): ParsedEmailLead | null {
  return parseYelpQuote(email) ?? parseDurable(email) ?? parseGoogle(email);
}

/** E.164 that satisfies public.leads.phone_e164, or null when the value cannot. */
export function toValidE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let e164: string | null = null;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    e164 = `+${digits}`;
  }
  if (!e164 || !/^\+[1-9][0-9]{7,14}$/.test(e164)) return null;
  return e164;
}

function parseYelpQuote(email: InboundEmail): ParsedEmailLead | null {
  const from = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  if (/login|password|preferences|credit card|terms of service|reset password/.test(subject)) {
    return null;
  }
  if (subject.includes("new reply")) return null;
  const fromYelp =
    from.includes("messaging.yelp.com") ||
    from.includes("@yelp.com") ||
    from.includes("@mail.yelp.com");
  if (!fromYelp) return null;
  const quote =
    subject.includes("requesting a quote") ||
    email.body.includes("utm_source=request_a_quote") ||
    /is interested in working with you/i.test(email.body);
  if (!quote) return null;

  const subjectName = /new message:\s*(.+?)\s+is requesting a quote/i.exec(email.subject);
  const bodyName = /^(.+?)\s+is interested in working with you/im.exec(email.body);
  const name = clean(subjectName?.[1] ?? bodyName?.[1] ?? null);
  const make = answerAfter(email.body, "What make is your vehicle?");
  const modelYear = answerAfter(email.body, "What model and year is your vehicle?");
  const parsedVehicle = splitYearMakeModel(modelYear);
  const miles = answerAfter(email.body, "How many miles does your vehicle have?");
  const details = answerAfter(email.body, "Are there any other details you'd like to share?");
  const service = answerAfter(email.body, "What type of auto repair service do you need?");
  const thread = /\/thread\/([A-Za-z0-9_-]+)/.exec(email.body);
  const replyToken = /reply\+([a-f0-9]+)@/i.exec(email.from);
  const externalKey = thread?.[1] ?? replyToken?.[1] ?? email.messageId;

  return {
    source: "Yelp",
    externalId: `yelp:${externalKey}`,
    name,
    email: null,
    phoneRaw: null,
    vehicleYear: parsedVehicle.year,
    vehicleMake: make ?? parsedVehicle.make,
    vehicleModel: parsedVehicle.model,
    vehicleMileage: parseMiles(miles),
    symptoms: joinSymptoms([service, details]),
    smsOptIn: false,
    customerOptOut: false,
  };
}

function parseDurable(email: InboundEmail): ParsedEmailLead | null {
  const from = email.from.toLowerCase();
  const durableFrom =
    from.includes("notifications@email.durable.com") ||
    from.includes("support@durable.team") ||
    from.includes("@email.durable.com");
  const durableSubject = /^new website lead from /i.test(email.subject.trim());
  if (!durableFrom && !durableSubject) return null;
  if (!/new website lead|left a message on/i.test(`${email.subject}\n${email.body}`)) return null;

  const message = labeled(email.body, "Message");
  const consent = labeled(email.body, "SMS Consent") ?? "";
  const vehicle = splitYearMakeModel(labeled(email.body, "Year, Make, Model"));
  const subjectName = /^new website lead from\s+(.+)$/i.exec(email.subject.trim());

  return {
    source: "Durable website",
    externalId: `durable:${email.messageId}`,
    name: labeled(email.body, "Name") ?? clean(subjectName?.[1] ?? null),
    email: normalizeEmail(labeled(email.body, "Email")),
    phoneRaw: labeled(email.body, "Phone"),
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    vehicleMileage: null,
    symptoms: message,
    smsOptIn: /i agree to receive/i.test(consent),
    customerOptOut: message ? detectOptOut(message) : false,
  };
}

function parseGoogle(email: InboundEmail): ParsedEmailLead | null {
  const from = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  if (/left a review|performance report|are you open|disapproved|optimi[sz]e|recommendation/.test(subject)) {
    return null;
  }

  const lsa =
    /local-services|localservices|google-lsa/.test(from) ||
    (/local services/.test(subject) && /new (lead|customer)/.test(subject));
  const gbp =
    from.includes("businessprofile-noreply@google.com") &&
    /sent you a message|new message/.test(subject);
  const ads =
    /you have a new lead/.test(subject) &&
    /ads\.google|googleads|ads-noreply@google\.com/.test(from);

  const source: EmailLeadSource | null = lsa
    ? "Google LSA"
    : gbp
      ? "Google Business Profile"
      : ads
        ? "Google Ads"
        : null;
  if (!source) return null;

  const name = labeled(email.body, "Name") ?? labeled(email.body, "Customer");
  const emailAddress = normalizeEmail(labeled(email.body, "Email"));
  const phoneRaw = labeled(email.body, "Phone") ?? labeled(email.body, "Phone number");
  if (!name && !emailAddress && !phoneRaw) return null;
  const prefix = source === "Google LSA" ? "lsa" : source === "Google Business Profile" ? "gbp" : "gads";

  return {
    source,
    externalId: `${prefix}:${email.messageId}`,
    name,
    email: emailAddress,
    phoneRaw,
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleMileage: null,
    symptoms: labeled(email.body, "Message"),
    smsOptIn: false,
    customerOptOut: false,
  };
}

function labeled(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(?:^|\\n)\\s*\\|?\\s*${escaped}\\s*(?:\\||:)?\\s*([^\\n|]+)`,
    "i",
  ).exec(body);
  if (!match?.[1]) return null;
  const value = match[1]
    .replace(/\[\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

function answerAfter(body: string, question: string): string | null {
  const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\n+([^\\n]+)`, "i").exec(body);
  return clean(match?.[1] ?? null);
}

function splitYearMakeModel(raw: string | null): {
  year: number | null;
  make: string | null;
  model: string | null;
} {
  if (!raw) return { year: null, make: null, model: null };
  const text = raw.trim();
  const leadYear = /^(\d{4})\s+(\S+)(?:\s+(.+))?$/.exec(text);
  if (leadYear) {
    const year = Number(leadYear[1]);
    return {
      year: year >= 1900 && year <= 2100 ? year : null,
      make: clean(leadYear[2] ?? null),
      model: clean(leadYear[3] ?? null),
    };
  }
  const embedded = /\b(19|20)\d{2}\b/.exec(text);
  const year = embedded ? Number(embedded[0]) : null;
  const rest = embedded ? text.replace(embedded[0], "").replace(/\s+/g, " ").trim() : text;
  const parts = rest.split(" ").filter(Boolean);
  return {
    year: year !== null && year >= 1900 && year <= 2100 ? year : null,
    make: clean(parts[0] ?? null),
    model: clean(parts.slice(1).join(" ") || null),
  };
}

function parseMiles(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isInteger(n) || n < 0 || n > 2_000_000) return null;
  return n;
}

function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null;
  const match = EMAIL_RE.exec(raw);
  return match ? match[0].toLowerCase() : null;
}

function joinSymptoms(parts: Array<string | null>): string | null {
  const text = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n");
  return text ? text.slice(0, 2000) : null;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : null;
}
