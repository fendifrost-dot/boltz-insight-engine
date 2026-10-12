import type { PublicPayment } from "./public.ts";

export const EVIDENCE_KINDS = [
  "estimate_repair_approval",
  "invoice",
  "parts_receipt",
  "photos",
  "pickup_release",
  "customer_messages",
  "notes",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  estimate_repair_approval: "Estimate / repair approval",
  invoice: "Invoice",
  parts_receipt: "Parts receipt",
  photos: "Photos",
  pickup_release: "Pickup / release record",
  customer_messages: "Customer messages",
  notes: "Notes",
};

export const EVIDENCE_STATUSES = ["missing", "ready", "not_applicable"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export type EvidenceMime = (typeof EVIDENCE_MIMES)[number];

/** Response states still waiting on the shop. Processing means evidence was already sent. */
export const RESPONSE_STATES = ["EVIDENCE_REQUIRED", "INQUIRY_EVIDENCE_REQUIRED"] as const;

export const DISPUTE_DEADLINE_MS = 3 * 24 * 60 * 60 * 1000;

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

const DISPUTE_ID_RE = /^[A-Za-z0-9_-]{1,192}$/;
const STATE_RE = /^[A-Z0-9_]{1,40}$/;

export function isEvidenceKind(value: string): value is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(value);
}

export function isEvidenceStatus(value: string): value is EvidenceStatus {
  return (EVIDENCE_STATUSES as readonly string[]).includes(value);
}

export function isEvidenceMime(value: string): value is EvidenceMime {
  return (EVIDENCE_MIMES as readonly string[]).includes(value);
}

export function disputeIdOk(value: string): boolean {
  return DISPUTE_ID_RE.test(value);
}

export function disputeStateOk(value: string): boolean {
  return STATE_RE.test(value);
}

export function disputeNeedsResponse(state: string): boolean {
  return (RESPONSE_STATES as readonly string[]).includes(state);
}

/** True when a response is still required and the deadline is overdue or inside the window. */
export function disputeDueSoon(
  args: { state: string; dueBy: string | null },
  now: Date,
  windowMs = DISPUTE_DEADLINE_MS,
): boolean {
  if (!disputeNeedsResponse(args.state) || !args.dueBy) return false;
  const due = Date.parse(args.dueBy);
  if (!Number.isFinite(due)) return false;
  return due <= now.getTime() + windowMs;
}

export type DueDispute = {
  disputeId: string;
  state: string;
  dueBy: string | null;
};

export type DeadlineSummary = {
  windowDays: number;
  count: number;
  nearestDueBy: string | null;
  disputeIds: string[];
};

export function deadlineSummary(
  rows: DueDispute[],
  now: Date,
  windowMs = DISPUTE_DEADLINE_MS,
): DeadlineSummary {
  const due = rows
    .filter((row) => disputeDueSoon(row, now, windowMs))
    .sort(
      (a, b) =>
        (a.dueBy ?? "").localeCompare(b.dueBy ?? "") || a.disputeId.localeCompare(b.disputeId),
    );
  return {
    windowDays: Math.round(windowMs / (24 * 60 * 60 * 1000)),
    count: due.length,
    nearestDueBy: due[0]?.dueBy ?? null,
    disputeIds: due.map((row) => row.disputeId).slice(0, 20),
  };
}

export function compareDisputesByDue<
  T extends { dueBy: string | null; createdAt: string | null; disputeId: string },
>(a: T, b: T): number {
  if (a.dueBy && b.dueBy && a.dueBy !== b.dueBy) return a.dueBy < b.dueBy ? -1 : 1;
  if (a.dueBy && !b.dueBy) return -1;
  if (!a.dueBy && b.dueBy) return 1;
  const created = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  if (created !== 0) return created;
  return a.disputeId < b.disputeId ? -1 : a.disputeId > b.disputeId ? 1 : 0;
}

export type CardPayment = {
  squareId: string;
  customerId: string | null;
  leadId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
};

/**
 * Other payments on the disputed card.
 * A customer id limits the match to that Square customer.
 * Without one, a linked lead limits it to that lead.
 * Brand and last 4 are both required.
 */
export function sameCardPaymentIds(args: {
  disputedPaymentId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  customerId: string | null;
  leadId: string | null;
  payments: CardPayment[];
}): string[] {
  const brand = args.cardBrand?.trim().toUpperCase() ?? "";
  const last4 = args.cardLast4 ?? "";
  if (!brand || !/^[0-9]{4}$/.test(last4)) return [];
  const ids: string[] = [];
  for (const payment of args.payments) {
    if (payment.squareId === args.disputedPaymentId) continue;
    if ((payment.cardBrand ?? "").trim().toUpperCase() !== brand) continue;
    if (payment.cardLast4 !== last4) continue;
    if (args.customerId) {
      if (payment.customerId !== args.customerId) continue;
    } else if (args.leadId) {
      if (payment.leadId !== args.leadId) continue;
    }
    ids.push(payment.squareId);
  }
  return ids;
}

export type InvoiceRef = {
  squareId: string;
  customerId: string | null;
  leadId: string | null;
};

/** Invoices for the dispute's Square customer or linked lead. */
export function relatedInvoiceIds(args: {
  customerId: string | null;
  leadId: string | null;
  invoices: InvoiceRef[];
}): string[] {
  if (!args.customerId && !args.leadId) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const invoice of args.invoices) {
    const hit =
      (args.customerId !== null && invoice.customerId === args.customerId) ||
      (args.leadId !== null && invoice.leadId === args.leadId);
    if (!hit || seen.has(invoice.squareId)) continue;
    seen.add(invoice.squareId);
    ids.push(invoice.squareId);
  }
  return ids;
}

export function parseEvidenceLink(
  value: string | null | undefined,
): { ok: true; link: string | null } | { ok: false; error: string } {
  if (value == null || value.trim() === "") return { ok: true, link: null };
  const trimmed = value.trim();
  if (trimmed.length > 2000) return { ok: false, error: "link_too_long" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "link_invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "link_must_be_https" };
  if (url.username || url.password) return { ok: false, error: "link_invalid" };
  return { ok: true, link: url.toString() };
}

export function parseEvidenceNote(
  value: string | null | undefined,
): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value == null || value.trim() === "") return { ok: true, note: null };
  const trimmed = value.trim();
  if (trimmed.length > 2000) return { ok: false, error: "note_too_long" };
  return { ok: true, note: trimmed };
}

export function evidenceExtension(mime: EvidenceMime): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "pdf";
}

export function evidenceBytesMatch(mime: EvidenceMime, bytes: Uint8Array): boolean {
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mime === "application/pdf") {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    );
  }
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const webp = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return riff === "RIFF" && webp === "WEBP";
}

export function safeEvidenceFileName(value: string): string {
  const base = value.split(/[/\\]/).pop() ?? "evidence";
  const cleaned = base.replace(/[^\w.\- ()]/g, "").trim();
  const sliced = cleaned.slice(0, 120);
  return sliced || "evidence";
}

export type PublicDispute = {
  disputeId: string;
  paymentId: string | null;
  amountCents: number;
  currency: string;
  reason: string;
  state: string;
  cardBrand: string | null;
  cardLast4: string | null;
  dueBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  leadId: string | null;
  customerId: string | null;
  matchStatus: string;
  needsResponse: boolean;
  dueSoon: boolean;
};

export const PUBLIC_DISPUTE_KEYS = [
  "disputeId",
  "paymentId",
  "amountCents",
  "currency",
  "reason",
  "state",
  "cardBrand",
  "cardLast4",
  "dueBy",
  "createdAt",
  "updatedAt",
  "leadId",
  "customerId",
  "matchStatus",
  "needsResponse",
  "dueSoon",
] as const;

export function toPublicDispute(
  row: {
    square_id: string;
    payment_id: string | null;
    amount_cents: number;
    currency: string;
    reason: string;
    state: string;
    card_brand: string | null;
    card_last4: string | null;
    due_by: string | null;
    created_at_square: string | null;
    updated_at_square: string | null;
    lead_id: string | null;
    customer_id: string | null;
    match_status: string;
  },
  now: Date,
): PublicDispute {
  return {
    disputeId: row.square_id,
    paymentId: row.payment_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    reason: row.reason,
    state: row.state,
    cardBrand: row.card_brand,
    cardLast4: row.card_last4,
    dueBy: row.due_by,
    createdAt: row.created_at_square,
    updatedAt: row.updated_at_square,
    leadId: row.lead_id,
    customerId: row.customer_id,
    matchStatus: row.match_status,
    needsResponse: disputeNeedsResponse(row.state),
    dueSoon: disputeDueSoon({ state: row.state, dueBy: row.due_by }, now),
  };
}

export type PublicEvidence = {
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  linkUrl: string | null;
  hasFile: boolean;
  fileName: string | null;
  note: string | null;
  updatedAt: string | null;
};

export type PublicInvoice = {
  squareId: string;
  invoiceNumber: string | null;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: string | null;
  leadId: string | null;
  orderId: string | null;
};

export type GatheredContext = {
  lead: { leadId: string; lifecycle: string | null; matchStatus: string } | null;
  threads: { threadId: string; lastMessageAt: string | null; messageCount: number }[];
  sameCardPayments: PublicPayment[];
  invoices: PublicInvoice[];
};

export function emptyChecklist(): { kind: EvidenceKind; status: EvidenceStatus }[] {
  return EVIDENCE_KINDS.map((kind) => ({ kind, status: "missing" }));
}
