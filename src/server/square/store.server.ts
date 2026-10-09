import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { applyLifecycleTransition } from "@/server/lead-inbox/lifecycle.server";
import { dbFailure, squareFrom, unwrapDb } from "./db.server.ts";
import type {
  CatalogDraft,
  CustomerDraft,
  InvoiceDraft,
  OrderDraft,
  PaymentDraft,
  RefundDraft,
} from "./map.ts";
import { matchLead, nextMatch, type LeadCandidate, type MatchStatus } from "./match.ts";
import { phoneLookupValues } from "./normalize.ts";
import { leadSquareRevenue, shouldMarkLeadPaid } from "./paid.ts";
import { dollarsFromCents, type WeekRollup } from "./rollup.ts";

type Lifecycle = Database["public"]["Enums"]["lead_lifecycle"];

function nowIso(): string {
  return new Date().toISOString();
}

export type SyncStateRow = {
  resource: string;
  cursor: string | null;
  synced_through: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_count: number;
};

export async function readSyncState(resource: string): Promise<SyncStateRow | null> {
  const result = await squareFrom<SyncStateRow>("square_sync_state")
    .select("resource,cursor,synced_through,last_success_at,last_error,last_count")
    .eq("resource", resource)
    .maybeSingle();
  if (result.error) throw dbFailure(result.error);
  return result.data;
}

export async function listSyncStates(): Promise<SyncStateRow[]> {
  const data = await unwrapDb(
    squareFrom<SyncStateRow[]>("square_sync_state").select(
      "resource,cursor,synced_through,last_success_at,last_error,last_count",
    ),
  );
  return data ?? [];
}

export async function writeSyncState(args: {
  resource: string;
  cursor?: string | null;
  syncedThrough?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastCount?: number;
  started?: boolean;
}): Promise<void> {
  const row: Record<string, unknown> = {
    resource: args.resource,
    updated_at: nowIso(),
  };
  if (args.cursor !== undefined) row["cursor"] = args.cursor;
  if (args.syncedThrough !== undefined) row["synced_through"] = args.syncedThrough;
  if (args.lastSuccessAt !== undefined) row["last_success_at"] = args.lastSuccessAt;
  if (args.lastError !== undefined) row["last_error"] = args.lastError;
  if (args.lastCount !== undefined) row["last_count"] = args.lastCount;
  if (args.started) row["last_started_at"] = nowIso();
  await unwrapDb(squareFrom("square_sync_state").upsert(row, { onConflict: "resource" }));
}

export async function claimWebhookEvent(args: {
  eventId: string;
  eventType: string;
  objectId: string | null;
}): Promise<"new" | "duplicate" | "retry"> {
  const inserted = await squareFrom("square_webhook_events")
    .insert({
      event_id: args.eventId,
      event_type: args.eventType,
      object_id: args.objectId,
      status: "received",
    })
    .select("event_id")
    .maybeSingle();
  if (!inserted.error) return "new";
  if (inserted.error.code !== "23505") throw dbFailure(inserted.error);
  const existing = await squareFrom<{ status: string }>("square_webhook_events")
    .select("status")
    .eq("event_id", args.eventId)
    .maybeSingle();
  if (existing.error) throw dbFailure(existing.error);
  if (existing.data?.status === "processed" || existing.data?.status === "ignored")
    return "duplicate";
  return "retry";
}

export async function finishWebhookEvent(
  eventId: string,
  status: "processed" | "failed" | "ignored",
): Promise<void> {
  await unwrapDb(
    squareFrom("square_webhook_events")
      .update({ status, processed_at: nowIso() })
      .eq("event_id", eventId),
  );
}

async function upsertChunk(table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let index = 0; index < rows.length; index += 200) {
    await unwrapDb(squareFrom(table).upsert(rows.slice(index, index + 200), { onConflict }));
  }
}

export async function savePayment(draft: PaymentDraft): Promise<void> {
  const row: Record<string, unknown> = {
    square_id: draft.square_id,
    status: draft.status,
    synced_at: nowIso(),
  };
  const put = (key: string, value: string | number | null) => {
    if (value !== null) row[key] = value;
  };
  put("location_id", draft.location_id);
  put("customer_id", draft.customer_id);
  put("order_id", draft.order_id);
  put("source_type", draft.source_type);
  put("card_brand", draft.card_brand);
  put("card_last4", draft.card_last4);
  put("buyer_phone_e164", draft.buyer_phone_e164);
  put("buyer_email", draft.buyer_email);
  put("created_at_square", draft.created_at_square);
  put("updated_at_square", draft.updated_at_square);
  if (draft.amount_cents !== null) {
    row["amount_cents"] = draft.amount_cents;
    row["currency"] = draft.currency ?? "USD";
  }
  if (draft.refunded_cents !== null) row["refunded_cents"] = draft.refunded_cents;
  if (draft.tip_cents !== null) row["tip_cents"] = draft.tip_cents;
  if (draft.fee_cents !== null) row["fee_cents"] = draft.fee_cents;

  if (draft.amount_cents === null) {
    const existing = await squareFrom<{ square_id: string }>("square_payments")
      .select("square_id")
      .eq("square_id", draft.square_id)
      .maybeSingle();
    if (existing.error) throw dbFailure(existing.error);
    if (!existing.data) throw new Error("square_payment_incomplete");
    await unwrapDb(squareFrom("square_payments").update(row).eq("square_id", draft.square_id));
    return;
  }
  await unwrapDb(squareFrom("square_payments").upsert(row, { onConflict: "square_id" }));
}

export async function saveRefund(draft: RefundDraft): Promise<void> {
  if (draft.amount_cents === null) {
    const existing = await squareFrom<{ square_id: string }>("square_refunds")
      .select("square_id")
      .eq("square_id", draft.square_id)
      .maybeSingle();
    if (existing.error) throw dbFailure(existing.error);
    if (!existing.data) throw new Error("square_refund_incomplete");
  }
  const row: Record<string, unknown> = {
    square_id: draft.square_id,
    status: draft.status,
    synced_at: nowIso(),
  };
  if (draft.payment_id) row["payment_id"] = draft.payment_id;
  if (draft.order_id) row["order_id"] = draft.order_id;
  if (draft.location_id) row["location_id"] = draft.location_id;
  if (draft.amount_cents !== null) {
    row["amount_cents"] = draft.amount_cents;
    row["currency"] = draft.currency ?? "USD";
  }
  if (draft.created_at_square) row["created_at_square"] = draft.created_at_square;
  if (draft.updated_at_square) row["updated_at_square"] = draft.updated_at_square;
  await unwrapDb(squareFrom("square_refunds").upsert(row, { onConflict: "square_id" }));
}

export async function saveOrder(draft: OrderDraft): Promise<void> {
  const row: Record<string, unknown> = {
    square_id: draft.square_id,
    state: draft.state,
    synced_at: nowIso(),
  };
  if (draft.location_id) row["location_id"] = draft.location_id;
  if (draft.customer_id) row["customer_id"] = draft.customer_id;
  if (draft.total_cents !== null) {
    row["total_cents"] = draft.total_cents;
    row["currency"] = draft.currency ?? "USD";
  }
  if (draft.created_at_square) row["created_at_square"] = draft.created_at_square;
  if (draft.updated_at_square) row["updated_at_square"] = draft.updated_at_square;
  if (draft.total_cents === null) {
    const existing = await squareFrom<{ square_id: string }>("square_orders")
      .select("square_id")
      .eq("square_id", draft.square_id)
      .maybeSingle();
    if (existing.error) throw dbFailure(existing.error);
    if (!existing.data) row["total_cents"] = 0;
  }
  await unwrapDb(squareFrom("square_orders").upsert(row, { onConflict: "square_id" }));
  if (draft.line_items.length === 0) return;
  await unwrapDb(
    squareFrom("square_order_line_items").delete().eq("order_square_id", draft.square_id),
  );
  await upsertChunk(
    "square_order_line_items",
    draft.line_items.map((line) => ({
      order_square_id: draft.square_id,
      line_uid: line.line_uid,
      name: line.name,
      quantity: line.quantity,
      gross_cents: line.gross_cents,
      catalog_object_id: line.catalog_object_id,
    })),
    "order_square_id,line_uid",
  );
}

export async function saveInvoice(draft: InvoiceDraft): Promise<void> {
  const row: Record<string, unknown> = {
    square_id: draft.square_id,
    status: draft.status,
    synced_at: nowIso(),
  };
  if (draft.amount_cents !== null) {
    row["amount_cents"] = draft.amount_cents;
    row["currency"] = draft.currency ?? "USD";
  } else {
    const existing = await squareFrom<{ square_id: string }>("square_invoices")
      .select("square_id")
      .eq("square_id", draft.square_id)
      .maybeSingle();
    if (existing.error) throw dbFailure(existing.error);
    if (!existing.data) {
      row["amount_cents"] = 0;
      row["currency"] = "USD";
    }
  }
  if (draft.order_id) row["order_id"] = draft.order_id;
  if (draft.customer_id) row["customer_id"] = draft.customer_id;
  if (draft.location_id) row["location_id"] = draft.location_id;
  if (draft.invoice_number) row["invoice_number"] = draft.invoice_number;
  if (draft.recipient_phone_e164) row["recipient_phone_e164"] = draft.recipient_phone_e164;
  if (draft.recipient_email) row["recipient_email"] = draft.recipient_email;
  if (draft.created_at_square) row["created_at_square"] = draft.created_at_square;
  if (draft.updated_at_square) row["updated_at_square"] = draft.updated_at_square;
  await unwrapDb(squareFrom("square_invoices").upsert(row, { onConflict: "square_id" }));
}

export async function saveCustomer(draft: CustomerDraft): Promise<void> {
  const row: Record<string, unknown> = {
    square_id: draft.square_id,
    synced_at: nowIso(),
    deleted_at: draft.deleted ? nowIso() : null,
  };
  if (draft.deleted) {
    row["phone_e164"] = null;
    row["email"] = null;
  } else {
    if (draft.phone_e164) row["phone_e164"] = draft.phone_e164;
    if (draft.email) row["email"] = draft.email;
  }
  if (draft.created_at_square) row["created_at_square"] = draft.created_at_square;
  if (draft.updated_at_square) row["updated_at_square"] = draft.updated_at_square;
  await unwrapDb(squareFrom("square_customers").upsert(row, { onConflict: "square_id" }));
}

export async function saveCatalog(items: CatalogDraft[]): Promise<void> {
  if (items.length === 0) return;
  await upsertChunk(
    "square_catalog_items",
    items.map((item) => ({
      square_id: item.square_id,
      item_type: item.item_type,
      name: item.name,
      updated_at_square: item.updated_at_square,
      is_deleted: item.is_deleted,
      synced_at: nowIso(),
    })),
    "square_id",
  );
}

type Contact = { phone: string | null; email: string | null };

async function customerContacts(ids: string[]): Promise<Map<string, Contact>> {
  const map = new Map<string, Contact>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const data = await unwrapDb(
    squareFrom<{ square_id: string; phone_e164: string | null; email: string | null }[]>(
      "square_customers",
    )
      .select("square_id,phone_e164,email")
      .in("square_id", unique.slice(0, 200)),
  );
  for (const row of data ?? []) {
    map.set(row.square_id, { phone: row.phone_e164, email: row.email });
  }
  return map;
}

async function leadCandidates(phones: string[], emails: string[]): Promise<LeadCandidate[]> {
  const found = new Map<string, LeadCandidate>();
  const add = (rows: LeadCandidate[] | null) => {
    for (const row of rows ?? []) found.set(row.id, row);
  };
  if (phones.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id,phone_e164,email")
      .in("phone_e164", phones.slice(0, 200));
    if (error) throw dbFailure(error);
    add(data);
  }
  for (let index = 0; index < emails.length; index += 20) {
    const chunk = emails.slice(index, index + 20);
    const filter = chunk.map((email) => `email.ilike.${email}`).join(",");
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id,phone_e164,email")
      .or(filter);
    if (error) throw dbFailure(error);
    add(data);
  }
  return [...found.values()];
}

type LinkRow = {
  square_id: string;
  customer_id: string | null;
  phone: string | null;
  email: string | null;
  lead_id: string | null;
  match_status: string;
};

async function linkRows(
  table: "square_payments" | "square_invoices" | "square_orders" | "square_customers",
  rows: LinkRow[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const contacts = await customerContacts(rows.map((row) => row.customer_id ?? "").filter(Boolean));
  const phones = new Set<string>();
  const emails = new Set<string>();
  const resolved = rows.map((row) => {
    const customer = row.customer_id ? contacts.get(row.customer_id) : undefined;
    const phone = row.phone ?? customer?.phone ?? null;
    const email = row.email ?? customer?.email ?? null;
    for (const value of phoneLookupValues(phone)) phones.add(value);
    if (email) emails.add(email);
    return { ...row, phone, email };
  });
  const candidates = await leadCandidates([...phones], [...emails]);
  const touched = new Set<string>();
  for (const row of resolved) {
    const computed = matchLead({ phone: row.phone, email: row.email, candidates });
    const match = nextMatch({ leadId: row.lead_id, matchStatus: row.match_status }, computed);
    if (match.leadId === row.lead_id && match.matchStatus === row.match_status) continue;
    if (row.lead_id) touched.add(row.lead_id);
    if (match.leadId) touched.add(match.leadId);
    await unwrapDb(
      squareFrom(table)
        .update({
          lead_id: match.leadId,
          match_status: match.matchStatus,
          matched_at: match.leadId ? nowIso() : null,
        })
        .eq("square_id", row.square_id),
    );
  }
  return [...touched];
}

export async function matchPaymentIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const data = await unwrapDb(
    squareFrom<
      {
        square_id: string;
        customer_id: string | null;
        buyer_phone_e164: string | null;
        buyer_email: string | null;
        lead_id: string | null;
        match_status: string;
      }[]
    >("square_payments")
      .select("square_id,customer_id,buyer_phone_e164,buyer_email,lead_id,match_status")
      .in("square_id", unique.slice(0, 200)),
  );
  return linkRows(
    "square_payments",
    (data ?? []).map((row) => ({
      square_id: row.square_id,
      customer_id: row.customer_id,
      phone: row.buyer_phone_e164,
      email: row.buyer_email,
      lead_id: row.lead_id,
      match_status: row.match_status,
    })),
  );
}

export async function matchInvoiceIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const data = await unwrapDb(
    squareFrom<
      {
        square_id: string;
        customer_id: string | null;
        recipient_phone_e164: string | null;
        recipient_email: string | null;
        lead_id: string | null;
        match_status: string;
      }[]
    >("square_invoices")
      .select("square_id,customer_id,recipient_phone_e164,recipient_email,lead_id,match_status")
      .in("square_id", unique.slice(0, 200)),
  );
  await linkRows(
    "square_invoices",
    (data ?? []).map((row) => ({
      square_id: row.square_id,
      customer_id: row.customer_id,
      phone: row.recipient_phone_e164,
      email: row.recipient_email,
      lead_id: row.lead_id,
      match_status: row.match_status,
    })),
  );
}

export async function matchOrderIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const data = await unwrapDb(
    squareFrom<
      {
        square_id: string;
        customer_id: string | null;
        lead_id: string | null;
        match_status: string;
      }[]
    >("square_orders")
      .select("square_id,customer_id,lead_id,match_status")
      .in("square_id", unique.slice(0, 200)),
  );
  await linkRows(
    "square_orders",
    (data ?? []).map((row) => ({
      square_id: row.square_id,
      customer_id: row.customer_id,
      phone: null,
      email: null,
      lead_id: row.lead_id,
      match_status: row.match_status,
    })),
  );
}

export async function matchCustomerIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const data = await unwrapDb(
    squareFrom<
      {
        square_id: string;
        phone_e164: string | null;
        email: string | null;
        lead_id: string | null;
        match_status: string;
      }[]
    >("square_customers")
      .select("square_id,phone_e164,email,lead_id,match_status")
      .in("square_id", unique.slice(0, 200)),
  );
  await linkRows(
    "square_customers",
    (data ?? []).map((row) => ({
      square_id: row.square_id,
      customer_id: null,
      phone: row.phone_e164,
      email: row.email,
      lead_id: row.lead_id,
      match_status: row.match_status,
    })),
  );
}

export async function refreshLeadForPayment(paymentId: string): Promise<void> {
  const result = await squareFrom<{ lead_id: string | null }>("square_payments")
    .select("lead_id")
    .eq("square_id", paymentId)
    .maybeSingle();
  if (result.error) throw dbFailure(result.error);
  if (result.data?.lead_id) await refreshLeadMoney([result.data.lead_id]);
}

export async function refreshLeadMoney(leadIds: string[]): Promise<number> {
  let paid = 0;
  for (const leadId of [...new Set(leadIds)]) {
    const leadResult = await supabaseAdmin
      .from("leads")
      .select("id,lifecycle")
      .eq("id", leadId)
      .maybeSingle();
    if (leadResult.error) throw dbFailure(leadResult.error);
    const lead = leadResult.data;
    if (!lead) continue;
    const payments = await unwrapDb(
      squareFrom<
        {
          square_id: string;
          status: string;
          amount_cents: number;
          refunded_cents: number;
          created_at_square: string | null;
          match_status: string;
        }[]
      >("square_payments")
        .select("square_id,status,amount_cents,refunded_cents,created_at_square,match_status")
        .eq("lead_id", leadId),
    );
    const rows = payments ?? [];
    const revenue = leadSquareRevenue(
      rows.map((row) => ({
        status: row.status,
        amountCents: row.amount_cents,
        refundedCents: row.refunded_cents,
        createdAt: row.created_at_square,
      })),
    );
    const { error } = await supabaseAdmin
      .from("leads")
      .update({
        square_gross_cents: revenue.grossCents,
        square_net_cents: revenue.netCents,
        square_paid_at: revenue.paidAt,
      })
      .eq("id", leadId);
    if (error) throw dbFailure(error);

    const evidence = rows
      .filter((row) =>
        shouldMarkLeadPaid({
          paymentStatus: row.status,
          matchStatus: row.match_status,
          lifecycle: lead.lifecycle,
        }),
      )
      .sort((a, b) => (a.created_at_square ?? "").localeCompare(b.created_at_square ?? ""))
      .at(-1);
    if (!evidence) continue;
    const transition = await applyLifecycleTransition({
      leadId,
      fromLifecycle: lead.lifecycle as Lifecycle,
      toLifecycle: "Paid",
      actor: "system",
      evidence: { basis: "payment_record", evidenceRef: evidence.square_id },
      summary: `Square payment ${evidence.square_id} recorded`,
    });
    if (transition.ok && transition.applied) paid += 1;
  }
  return paid;
}

type RollupPaymentRow = {
  status: string;
  amount_cents: number;
  created_at_square: string | null;
  lead_id: string | null;
};

type RollupRefundRow = {
  status: string;
  amount_cents: number;
  created_at_square: string | null;
};

export async function loadRollupRows(): Promise<{
  payments: RollupPaymentRow[];
  refunds: RollupRefundRow[];
  sources: Map<string, string | null>;
}> {
  const payments = await selectPages<RollupPaymentRow>(
    "square_payments",
    "status,amount_cents,created_at_square,lead_id",
  );
  const refunds = await selectPages<RollupRefundRow>(
    "square_refunds",
    "status,amount_cents,created_at_square",
  );
  const leadIds = [
    ...new Set(payments.map((row) => row.lead_id).filter((id): id is string => Boolean(id))),
  ];
  const sources = new Map<string, string | null>();
  for (let index = 0; index < leadIds.length; index += 200) {
    const chunk = leadIds.slice(index, index + 200);
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id,lead_source")
      .in("id", chunk);
    if (error) throw dbFailure(error);
    for (const row of data ?? []) sources.set(row.id, row.lead_source);
  }
  return { payments, refunds, sources };
}

async function selectPages<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  const page = 1000;
  for (let from = 0; from < 20_000; from += page) {
    const data = await unwrapDb(
      squareFrom<T[]>(table)
        .select(columns)
        .range(from, from + page - 1),
    );
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

export async function writeSalesWeeks(weeks: WeekRollup[]): Promise<void> {
  if (weeks.length === 0) return;
  const syncedAt = nowIso();
  const rows = weeks.map((week) => ({
    week_start: week.weekStart,
    square_gross: dollarsFromCents(week.grossCents),
    square_net: dollarsFromCents(week.netCents),
    square_refunds: dollarsFromCents(week.refundCents),
    square_ticket_count: week.ticketCount,
    square_avg_ticket: dollarsFromCents(week.avgTicketCents),
    square_attributed: Object.fromEntries(
      Object.entries(week.attributedBySource).map(([source, cents]) => [
        source,
        dollarsFromCents(cents),
      ]),
    ),
    square_synced_at: syncedAt,
  }));
  const { error } = await supabaseAdmin
    .from("sales_weekly")
    .upsert(rows, { onConflict: "week_start" });
  if (error) throw dbFailure(error);
}

export type StoredPayment = {
  square_id: string;
  status: string;
  amount_cents: number;
  refunded_cents: number;
  currency: string;
  created_at_square: string | null;
  lead_id: string | null;
  match_status: string;
  card_brand: string | null;
  card_last4: string | null;
  order_id: string | null;
};

const PUBLIC_PAYMENT_COLUMNS =
  "square_id,status,amount_cents,refunded_cents,currency,created_at_square,lead_id,match_status,card_brand,card_last4,order_id";

export async function listPaymentsForRead(args: {
  leadId?: string | null;
  unmatchedOnly?: boolean;
  limit: number;
}): Promise<StoredPayment[]> {
  let query = squareFrom<StoredPayment[]>("square_payments")
    .select(PUBLIC_PAYMENT_COLUMNS)
    .order("created_at_square", { ascending: false })
    .limit(args.limit);
  if (args.leadId) query = query.eq("lead_id", args.leadId);
  if (args.unmatchedOnly) query = query.is("lead_id", null);
  const data = await unwrapDb(query);
  return data ?? [];
}

export function isMatchStatus(value: string): value is MatchStatus {
  return (
    value === "exact_phone" ||
    value === "exact_email" ||
    value === "ambiguous" ||
    value === "unmatched"
  );
}
