import { normalizePhone } from "./lead-inbox-thread-sync.ts";

export const FIRST_SMS_OUTBOUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export const LEAD_LIST_SELECT =
  "id, name, phone_e164, lifecycle, consent_status, vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, symptoms, lead_source, last_inbound_at, last_outbound_at, last_message_at, unread_count, created_at";

type DeliveryState = "queued" | "sending" | "sent" | "delivered" | "failed" | "received";
type MessageDirection = "inbound" | "outbound";

export type LeadListMessage = {
  lead_id: string;
  body: string | null;
  direction: MessageDirection;
  delivery_state: string;
  created_at: string;
};

export type LeadListStamp = {
  id: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

export type LastMessagePreview = {
  last_preview_direction: MessageDirection | null;
  last_preview_at: string | null;
  last_preview_body: string | null;
  last_preview_delivery_state: string | null;
};

export type FirstSmsBlock =
  { block: true; reason: string; sentAt: string } | { block: false; reason: null; sentAt: null };

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function previewFromStamps(
  lead: LeadListStamp,
): Pick<LastMessagePreview, "last_preview_direction" | "last_preview_at"> {
  const inboundMs = lead.last_inbound_at ? Date.parse(lead.last_inbound_at) : Number.NaN;
  const outboundMs = lead.last_outbound_at ? Date.parse(lead.last_outbound_at) : Number.NaN;
  const hasInbound = Number.isFinite(inboundMs);
  const hasOutbound = Number.isFinite(outboundMs);
  if (!hasInbound && !hasOutbound) {
    return { last_preview_direction: null, last_preview_at: lead.last_message_at };
  }
  if (hasOutbound && (!hasInbound || outboundMs >= inboundMs)) {
    return { last_preview_direction: "outbound", last_preview_at: lead.last_outbound_at };
  }
  return { last_preview_direction: "inbound", last_preview_at: lead.last_inbound_at };
}

export function snippetBody(body: string | null | undefined, max = 80): string | null {
  if (!body) return null;
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

export function buildLeadListRows<T extends LeadListStamp>(
  leads: T[],
  messages: LeadListMessage[],
): Array<T & LastMessagePreview> {
  const latestByLead = new Map<string, LeadListMessage>();
  for (const message of messages) {
    const existing = latestByLead.get(message.lead_id);
    if (!existing || Date.parse(message.created_at) > Date.parse(existing.created_at)) {
      latestByLead.set(message.lead_id, message);
    }
  }

  return leads.map((lead) => {
    const message = latestByLead.get(lead.id) ?? null;
    if (message) {
      const stamps = previewFromStamps(lead);
      const messageMs = Date.parse(message.created_at);
      const stampMs = stamps.last_preview_at ? Date.parse(stamps.last_preview_at) : Number.NaN;
      const messageIsLatest = !Number.isFinite(stampMs) || messageMs >= stampMs;
      return {
        ...lead,
        last_preview_direction: messageIsLatest ? message.direction : stamps.last_preview_direction,
        last_preview_at: messageIsLatest ? message.created_at : stamps.last_preview_at,
        last_preview_body: messageIsLatest ? snippetBody(message.body) : null,
        last_preview_delivery_state: messageIsLatest ? message.delivery_state : null,
      };
    }
    const stamps = previewFromStamps(lead);
    return {
      ...lead,
      last_preview_direction: stamps.last_preview_direction,
      last_preview_at: stamps.last_preview_at,
      last_preview_body: null,
      last_preview_delivery_state: null,
    };
  });
}

export function sortLeadListRows<
  T extends LastMessagePreview & { id: string; last_message_at: string | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aAt = a.last_preview_at ?? a.last_message_at ?? "";
    const bAt = b.last_preview_at ?? b.last_message_at ?? "";
    if (aAt !== bAt) return aAt < bAt ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
}

export function mergeLeadListSources<T extends { id: string }>(primary: T[], extra: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of extra) byId.set(row.id, row);
  for (const row of primary) byId.set(row.id, row);
  return [...byId.values()];
}

export function recentOutboundBlocksFirstSms(args: {
  nowMs: number;
  windowMs?: number;
  lastOutboundAt?: string | null;
  latestOutboundMessageAt?: string | null;
  latestOutboundSentEventAt?: string | null;
}): FirstSmsBlock {
  const windowMs = args.windowMs ?? FIRST_SMS_OUTBOUND_WINDOW_MS;
  const sentAt = laterIso(
    args.lastOutboundAt,
    laterIso(args.latestOutboundMessageAt, args.latestOutboundSentEventAt),
  );
  if (!sentAt) return { block: false, reason: null, sentAt: null };
  const sentMs = Date.parse(sentAt);
  if (!Number.isFinite(sentMs)) return { block: false, reason: null, sentAt: null };
  if (args.nowMs - sentMs >= windowMs) return { block: false, reason: null, sentAt: null };
  const when = new Date(sentMs).toISOString();
  return {
    block: true,
    sentAt: when,
    reason: `Already sent an outbound SMS to this number at ${when}. Open the existing thread instead of sending a second first-contact text.`,
  };
}

export function matchExistingLeadForNewSms<
  T extends {
    id: string;
    name?: string | null;
    phone_e164?: string | null;
    last_outbound_at?: string | null;
    last_preview_at?: string | null;
    last_preview_direction?: MessageDirection | null;
  },
>(
  phone: string,
  leads: T[],
  nowMs: number,
): { lead: T; blocksFirstSms: boolean; sentAt: string | null } | null {
  const wanted = normalizePhone(phone);
  if (!wanted) return null;
  const lead = leads.find((row) => normalizePhone(row.phone_e164) === wanted);
  if (!lead) return null;
  const outboundAt =
    lead.last_preview_direction === "outbound"
      ? (lead.last_preview_at ?? lead.last_outbound_at ?? null)
      : (lead.last_outbound_at ?? null);
  const guard = recentOutboundBlocksFirstSms({ nowMs, lastOutboundAt: outboundAt });
  return { lead, blocksFirstSms: guard.block, sentAt: guard.block ? guard.sentAt : outboundAt };
}

/** Map RingCentral messageStatus after a successful POST. Queued means accepted, not unsent. */
export function mapProviderDeliveryState(messageStatus: string | null | undefined): DeliveryState {
  const normalized = (messageStatus ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (
    normalized === "deliveryfailed" ||
    normalized === "sendingfailed" ||
    normalized === "failed"
  ) {
    return "failed";
  }
  if (normalized === "delivered") return "delivered";
  if (normalized === "sending") return "sending";
  return "sent";
}

export function displayDeliveryState(message: {
  direction: MessageDirection | string;
  delivery_state: string;
  provider_message_id?: string | null;
}): string {
  if (
    message.direction === "outbound" &&
    message.delivery_state === "queued" &&
    Boolean(message.provider_message_id)
  ) {
    return "sent";
  }
  return message.delivery_state;
}
