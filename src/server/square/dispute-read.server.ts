import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { squareErrorCode } from "./errors.ts";
import { toPublicPayment, type PublicPayment } from "./public.ts";
import {
  EVIDENCE_KINDS,
  EVIDENCE_LABELS,
  compareDisputesByDue,
  deadlineSummary,
  disputeDueSoon,
  disputeIdOk,
  disputeStateOk,
  isEvidenceKind,
  isEvidenceStatus,
  relatedInvoiceIds,
  sameCardPaymentIds,
  toPublicDispute,
  type DeadlineSummary,
  type EvidenceKind,
  type GatheredContext,
  type PublicDispute,
  type PublicEvidence,
  type PublicInvoice,
} from "./dispute.ts";
import {
  getStoredDispute,
  invoicesForLink,
  listEvidence,
  listStoredDisputes,
  paymentsForCard,
  signedEvidenceUrl,
  type StoredDispute,
  type StoredEvidence,
} from "./dispute-store.server.ts";

export type OwnerMessage = {
  id: string;
  direction: string;
  createdAt: string;
  body: string | null;
};

export type DisputeDetail = PublicDispute & {
  evidence: (PublicEvidence & { signedUrl: string | null })[];
  gathered: GatheredContext;
  messages: OwnerMessage[];
};

export type DisputeListResult = {
  disputes: PublicDispute[];
  deadlines: DeadlineSummary;
};

function publicEvidence(row: StoredEvidence | undefined, kind: EvidenceKind): PublicEvidence {
  const status = row && isEvidenceStatus(row.status) ? row.status : "missing";
  return {
    kind,
    label: EVIDENCE_LABELS[kind],
    status,
    linkUrl: row?.link_url ?? null,
    hasFile: Boolean(row?.storage_path),
    fileName: row?.file_name ?? null,
    note: row?.note ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function gatheredFor(
  dispute: StoredDispute,
  audience: "owner" | "agent",
): Promise<{
  gathered: GatheredContext;
  messages: OwnerMessage[];
  evidence: DisputeDetail["evidence"];
}> {
  const evidenceRows = await listEvidence(dispute.square_id);
  const byKind = new Map(evidenceRows.map((row) => [row.kind, row]));
  const evidence: DisputeDetail["evidence"] = [];
  for (const kind of EVIDENCE_KINDS) {
    const row = byKind.get(kind);
    const item = publicEvidence(row && isEvidenceKind(row.kind) ? row : undefined, kind);
    let signedUrl: string | null = null;
    if (audience === "owner" && row?.storage_path) {
      signedUrl = await signedEvidenceUrl(row.storage_path).catch(() => null);
    }
    evidence.push({ ...item, signedUrl });
  }

  let lifecycle: string | null = null;
  const threads: GatheredContext["threads"] = [];
  const messages: OwnerMessage[] = [];
  if (dispute.lead_id) {
    const lead = await supabaseAdmin
      .from("leads")
      .select("id,lifecycle")
      .eq("id", dispute.lead_id)
      .maybeSingle();
    if (lead.error) throw new Error(`square_storage_${lead.error.code ?? "db_error"}`);
    lifecycle = lead.data?.lifecycle ?? null;

    const threadRows = await supabaseAdmin
      .from("message_threads")
      .select("id,last_message_at")
      .eq("lead_id", dispute.lead_id)
      .order("last_message_at", { ascending: false })
      .limit(10);
    if (threadRows.error) throw new Error(`square_storage_${threadRows.error.code ?? "db_error"}`);
    for (const thread of threadRows.data ?? []) {
      const count = await supabaseAdmin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", thread.id);
      if (count.error) throw new Error(`square_storage_${count.error.code ?? "db_error"}`);
      threads.push({
        threadId: thread.id,
        lastMessageAt: thread.last_message_at,
        messageCount: count.count ?? 0,
      });
    }

    if (audience === "owner") {
      const recent = await supabaseAdmin
        .from("messages")
        .select("id,direction,created_at,body")
        .eq("lead_id", dispute.lead_id)
        .order("created_at", { ascending: false })
        .limit(8);
      if (recent.error) throw new Error(`square_storage_${recent.error.code ?? "db_error"}`);
      for (const message of recent.data ?? []) {
        messages.push({
          id: message.id,
          direction: message.direction,
          createdAt: message.created_at,
          body: message.body ? message.body.slice(0, 240) : null,
        });
      }
    }
  }

  let sameCard: PublicPayment[] = [];
  if (dispute.card_last4) {
    const payments = await paymentsForCard(dispute.card_last4);
    const ids = new Set(
      sameCardPaymentIds({
        disputedPaymentId: dispute.payment_id,
        cardBrand: dispute.card_brand,
        cardLast4: dispute.card_last4,
        customerId: dispute.customer_id,
        leadId: dispute.lead_id,
        payments: payments.map((payment) => ({
          squareId: payment.square_id,
          customerId: payment.customer_id,
          leadId: payment.lead_id,
          cardBrand: payment.card_brand,
          cardLast4: payment.card_last4,
        })),
      }),
    );
    sameCard = payments.filter((payment) => ids.has(payment.square_id)).map(toPublicPayment);
  }

  const invoiceRows = await invoicesForLink({
    customerId: dispute.customer_id,
    leadId: dispute.lead_id,
  });
  const invoiceIds = new Set(
    relatedInvoiceIds({
      customerId: dispute.customer_id,
      leadId: dispute.lead_id,
      invoices: invoiceRows.map((invoice) => ({
        squareId: invoice.square_id,
        customerId: invoice.customer_id,
        leadId: invoice.lead_id,
      })),
    }),
  );
  const invoices: PublicInvoice[] = invoiceRows
    .filter((invoice) => invoiceIds.has(invoice.square_id))
    .map((invoice) => ({
      squareId: invoice.square_id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      amountCents: invoice.amount_cents,
      currency: invoice.currency,
      createdAt: invoice.created_at_square,
      leadId: invoice.lead_id,
      orderId: invoice.order_id,
    }));

  return {
    evidence,
    messages,
    gathered: {
      lead: dispute.lead_id
        ? { leadId: dispute.lead_id, lifecycle, matchStatus: dispute.match_status }
        : null,
      threads,
      sameCardPayments: sameCard,
      invoices,
    },
  };
}

export async function readDisputeList(args: {
  now?: Date;
  limit?: number;
  dueWithinDays?: number | null;
  state?: string | null;
}): Promise<DisputeListResult> {
  const now = args.now ?? new Date();
  const limit = args.limit ?? 20;
  const rows = await listStoredDisputes();
  const deadlines = deadlineSummary(
    rows.map((row) => ({ disputeId: row.square_id, state: row.state, dueBy: row.due_by })),
    now,
  );
  let filtered = rows;
  if (args.state) filtered = filtered.filter((row) => row.state === args.state);
  if (args.dueWithinDays) {
    const windowMs = args.dueWithinDays * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((row) =>
      disputeDueSoon({ state: row.state, dueBy: row.due_by }, now, windowMs),
    );
  }
  const disputes = filtered
    .map((row) => toPublicDispute(row, now))
    .sort(compareDisputesByDue)
    .slice(0, limit);
  return { disputes, deadlines };
}

export async function readDisputeDetail(args: {
  disputeId: string;
  now?: Date;
  audience: "owner" | "agent";
}): Promise<DisputeDetail | null> {
  if (!disputeIdOk(args.disputeId)) return null;
  const now = args.now ?? new Date();
  const row = await getStoredDispute(args.disputeId);
  if (!row) return null;
  const extra = await gatheredFor(row, args.audience);
  return { ...toPublicDispute(row, now), ...extra };
}

export async function readDisputesForAgent(args: {
  now?: Date;
  disputeId?: string | null;
  limit?: number;
  dueWithinDays?: number | null;
  state?: string | null;
}): Promise<
  | { view: "list"; disputes: PublicDispute[]; deadlines: DeadlineSummary }
  | { view: "detail"; dispute: Omit<DisputeDetail, "messages"> | null }
  | { error: string }
> {
  try {
    if (args.disputeId) {
      if (!disputeIdOk(args.disputeId)) return { error: "invalid_dispute_id" };
      const detail = await readDisputeDetail({
        disputeId: args.disputeId,
        audience: "agent",
        ...(args.now ? { now: args.now } : {}),
      });
      if (!detail) return { view: "detail", dispute: null };
      const { messages: _messages, evidence, ...rest } = detail;
      return {
        view: "detail",
        dispute: {
          ...rest,
          evidence: evidence.map((item) => ({ ...item, signedUrl: null })),
        },
      };
    }
    if (args.state && !disputeStateOk(args.state)) return { error: "invalid_state" };
    const list = await readDisputeList({
      ...(args.now ? { now: args.now } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.dueWithinDays != null ? { dueWithinDays: args.dueWithinDays } : {}),
      ...(args.state ? { state: args.state } : {}),
    });
    return { view: "list", ...list };
  } catch (error) {
    return { error: squareErrorCode(error) };
  }
}
