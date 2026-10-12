import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { dbFailure, squareFrom, unwrapDb } from "./db.server.ts";
import {
  EVIDENCE_KINDS,
  deadlineSummary,
  disputeNeedsResponse,
  isEvidenceKind,
  isEvidenceStatus,
  type DeadlineSummary,
  type EvidenceKind,
  type EvidenceStatus,
} from "./dispute.ts";
import type { DisputeDraft } from "./map.ts";
import { isMatchStatus } from "./store.server.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export type StoredDispute = {
  square_id: string;
  payment_id: string | null;
  amount_cents: number;
  currency: string;
  reason: string;
  state: string;
  card_brand: string | null;
  card_last4: string | null;
  due_by: string | null;
  customer_id: string | null;
  lead_id: string | null;
  match_status: string;
  created_at_square: string | null;
  updated_at_square: string | null;
};

const DISPUTE_COLUMNS =
  "square_id,payment_id,amount_cents,currency,reason,state,card_brand,card_last4,due_by,customer_id,lead_id,match_status,created_at_square,updated_at_square";

export async function saveDispute(draft: DisputeDraft): Promise<void> {
  const partial = draft.amount_cents === null;
  if (partial) {
    const existing = await squareFrom<{ square_id: string }>("square_disputes")
      .select("square_id")
      .eq("square_id", draft.square_id)
      .maybeSingle();
    if (existing.error) throw dbFailure(existing.error);
    if (!existing.data) throw new Error("square_dispute_incomplete");
  }

  const row: Record<string, unknown> = {
    square_id: draft.square_id,
    state: draft.state,
    reason: draft.reason,
    synced_at: nowIso(),
  };
  const put = (key: string, value: string | number | null) => {
    if (partial) {
      if (value !== null) row[key] = value;
      return;
    }
    row[key] = value;
  };
  put("payment_id", draft.payment_id);
  put("location_id", draft.location_id);
  put("card_brand", draft.card_brand);
  put("due_by", draft.due_by);
  put("brand_dispute_id", draft.brand_dispute_id);
  put("square_version", draft.square_version);
  put("reported_at", draft.reported_at);
  put("created_at_square", draft.created_at_square);
  put("updated_at_square", draft.updated_at_square);
  if (draft.amount_cents !== null) {
    row["amount_cents"] = draft.amount_cents;
    row["currency"] = draft.currency ?? "USD";
  }
  await unwrapDb(squareFrom("square_disputes").upsert(row, { onConflict: "square_id" }));
}

/** Inserts any missing checklist rows. Existing status, links, and files stay. */
export async function ensureDisputeChecklist(disputeId: string): Promise<void> {
  for (const kind of EVIDENCE_KINDS) {
    const inserted = await squareFrom("square_dispute_evidence").insert({
      dispute_id: disputeId,
      kind,
      status: "missing",
    });
    if (inserted.error && inserted.error.code !== "23505") throw dbFailure(inserted.error);
  }
}

export async function missingPaymentIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const found = new Set<string>();
  for (let index = 0; index < unique.length; index += 200) {
    const chunk = unique.slice(index, index + 200);
    const data = await unwrapDb(
      squareFrom<{ square_id: string }[]>("square_payments")
        .select("square_id")
        .in("square_id", chunk),
    );
    for (const row of data ?? []) found.add(row.square_id);
  }
  return unique.filter((id) => !found.has(id));
}

export async function linkDisputeIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  for (let index = 0; index < unique.length; index += 200) {
    const chunk = unique.slice(index, index + 200);
    const disputes = await unwrapDb(
      squareFrom<{ square_id: string; payment_id: string | null; card_brand: string | null }[]>(
        "square_disputes",
      )
        .select("square_id,payment_id,card_brand")
        .in("square_id", chunk),
    );
    const paymentIds = [
      ...new Set(
        (disputes ?? []).map((row) => row.payment_id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const payments = new Map<
      string,
      {
        customer_id: string | null;
        lead_id: string | null;
        match_status: string;
        card_brand: string | null;
        card_last4: string | null;
      }
    >();
    for (let paymentIndex = 0; paymentIndex < paymentIds.length; paymentIndex += 200) {
      const paymentChunk = paymentIds.slice(paymentIndex, paymentIndex + 200);
      const rows = await unwrapDb(
        squareFrom<
          {
            square_id: string;
            customer_id: string | null;
            lead_id: string | null;
            match_status: string;
            card_brand: string | null;
            card_last4: string | null;
          }[]
        >("square_payments")
          .select("square_id,customer_id,lead_id,match_status,card_brand,card_last4")
          .in("square_id", paymentChunk),
      );
      for (const row of rows ?? []) payments.set(row.square_id, row);
    }
    for (const dispute of disputes ?? []) {
      if (!dispute.payment_id) continue;
      const payment = payments.get(dispute.payment_id);
      if (!payment) continue;
      const matchStatus = isMatchStatus(payment.match_status) ? payment.match_status : "unmatched";
      const patch: Record<string, unknown> = {
        customer_id: payment.customer_id,
        lead_id: payment.lead_id,
        match_status: matchStatus,
        matched_at: payment.lead_id ? nowIso() : null,
        card_last4: payment.card_last4,
        synced_at: nowIso(),
      };
      if (!dispute.card_brand && payment.card_brand) patch["card_brand"] = payment.card_brand;
      await unwrapDb(
        squareFrom("square_disputes").update(patch).eq("square_id", dispute.square_id),
      );
    }
  }
}

export async function listStoredDisputes(): Promise<StoredDispute[]> {
  const rows: StoredDispute[] = [];
  const page = 500;
  for (let from = 0; from < 2_000; from += page) {
    const data = await unwrapDb(
      squareFrom<StoredDispute[]>("square_disputes")
        .select(DISPUTE_COLUMNS)
        .range(from, from + page - 1),
    );
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

export async function getStoredDispute(disputeId: string): Promise<StoredDispute | null> {
  const result = await squareFrom<StoredDispute>("square_disputes")
    .select(DISPUTE_COLUMNS)
    .eq("square_id", disputeId)
    .maybeSingle();
  if (result.error) throw dbFailure(result.error);
  return result.data;
}

export type StoredEvidence = {
  kind: string;
  status: string;
  link_url: string | null;
  storage_path: string | null;
  file_name: string | null;
  note: string | null;
  updated_at: string | null;
};

export async function listEvidence(disputeId: string): Promise<StoredEvidence[]> {
  const data = await unwrapDb(
    squareFrom<StoredEvidence[]>("square_dispute_evidence")
      .select("kind,status,link_url,storage_path,file_name,note,updated_at")
      .eq("dispute_id", disputeId),
  );
  return data ?? [];
}

export async function updateEvidenceRow(args: {
  disputeId: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  linkUrl: string | null;
  note: string | null;
  clearFile: boolean;
}): Promise<void> {
  await ensureDisputeChecklist(args.disputeId);
  const existing = await squareFrom<{ storage_path: string | null }>("square_dispute_evidence")
    .select("storage_path")
    .eq("dispute_id", args.disputeId)
    .eq("kind", args.kind)
    .maybeSingle();
  if (existing.error) throw dbFailure(existing.error);
  const patch: Record<string, unknown> = {
    status: args.status,
    link_url: args.linkUrl,
    note: args.note,
    updated_at: nowIso(),
  };
  if (args.clearFile) {
    patch["storage_path"] = null;
    patch["file_name"] = null;
  }
  await unwrapDb(
    squareFrom("square_dispute_evidence")
      .update(patch)
      .eq("dispute_id", args.disputeId)
      .eq("kind", args.kind),
  );
  if (args.clearFile && existing.data?.storage_path) {
    await supabaseAdmin.storage.from("dispute-evidence").remove([existing.data.storage_path]);
  }
}

export async function attachEvidenceFile(args: {
  disputeId: string;
  kind: EvidenceKind;
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  extension: string;
}): Promise<void> {
  await ensureDisputeChecklist(args.disputeId);
  const existing = await squareFrom<{ storage_path: string | null; status: string }>(
    "square_dispute_evidence",
  )
    .select("storage_path,status")
    .eq("dispute_id", args.disputeId)
    .eq("kind", args.kind)
    .maybeSingle();
  if (existing.error) throw dbFailure(existing.error);
  const path = `${args.disputeId}/${args.kind}/${crypto.randomUUID()}.${args.extension}`;
  const upload = await supabaseAdmin.storage.from("dispute-evidence").upload(path, args.bytes, {
    contentType: args.contentType,
    upsert: false,
  });
  if (upload.error) throw new Error("square_evidence_upload_failed");
  const status =
    existing.data?.status === "missing" || !existing.data?.status ? "ready" : existing.data.status;
  const updated = await squareFrom("square_dispute_evidence")
    .update({
      storage_path: path,
      file_name: args.fileName,
      status: isEvidenceStatus(status) ? status : "ready",
      updated_at: nowIso(),
    })
    .eq("dispute_id", args.disputeId)
    .eq("kind", args.kind);
  if (updated.error) {
    await supabaseAdmin.storage.from("dispute-evidence").remove([path]);
    throw dbFailure(updated.error);
  }
  if (existing.data?.storage_path && existing.data.storage_path !== path) {
    await supabaseAdmin.storage.from("dispute-evidence").remove([existing.data.storage_path]);
  }
}

export async function signedEvidenceUrl(path: string): Promise<string | null> {
  const signed = await supabaseAdmin.storage.from("dispute-evidence").createSignedUrl(path, 600);
  if (signed.error || !signed.data?.signedUrl) return null;
  return signed.data.signedUrl;
}

export async function paymentsForCard(last4: string): Promise<
  {
    square_id: string;
    customer_id: string | null;
    lead_id: string | null;
    card_brand: string | null;
    card_last4: string | null;
    status: string;
    amount_cents: number;
    refunded_cents: number;
    currency: string;
    created_at_square: string | null;
    match_status: string;
    order_id: string | null;
  }[]
> {
  const data = await unwrapDb(
    squareFrom<
      {
        square_id: string;
        customer_id: string | null;
        lead_id: string | null;
        card_brand: string | null;
        card_last4: string | null;
        status: string;
        amount_cents: number;
        refunded_cents: number;
        currency: string;
        created_at_square: string | null;
        match_status: string;
        order_id: string | null;
      }[]
    >("square_payments")
      .select(
        "square_id,customer_id,lead_id,card_brand,card_last4,status,amount_cents,refunded_cents,currency,created_at_square,match_status,order_id",
      )
      .eq("card_last4", last4)
      .limit(100),
  );
  return data ?? [];
}

export type StoredInvoiceRef = {
  square_id: string;
  customer_id: string | null;
  lead_id: string | null;
  invoice_number: string | null;
  status: string;
  amount_cents: number;
  currency: string;
  created_at_square: string | null;
  order_id: string | null;
};

const INVOICE_COLUMNS =
  "square_id,customer_id,lead_id,invoice_number,status,amount_cents,currency,created_at_square,order_id";

export async function invoicesForLink(args: {
  customerId: string | null;
  leadId: string | null;
}): Promise<StoredInvoiceRef[]> {
  const rows = new Map<string, StoredInvoiceRef>();
  const take = async (column: "customer_id" | "lead_id", value: string) => {
    const data = await unwrapDb(
      squareFrom<StoredInvoiceRef[]>("square_invoices")
        .select(INVOICE_COLUMNS)
        .eq(column, value)
        .limit(40),
    );
    for (const row of data ?? []) rows.set(row.square_id, row);
  };
  if (args.customerId) await take("customer_id", args.customerId);
  if (args.leadId) await take("lead_id", args.leadId);
  return [...rows.values()];
}

export async function recordDisputeDeadline(now = new Date()): Promise<DeadlineSummary> {
  const rows = await listStoredDisputes();
  const summary = deadlineSummary(
    rows.map((row) => ({ disputeId: row.square_id, state: row.state, dueBy: row.due_by })),
    now,
  );
  const open = rows.filter((row) => disputeNeedsResponse(row.state)).length;
  await recordHealth({
    provider: "square",
    checkName: "dispute_deadline",
    ok: summary.count === 0,
    detail:
      summary.count === 0
        ? `no disputes due within 3 days; ${open} still need a response`
        : `${summary.count} disputes due within 3 days; nearest ${summary.nearestDueBy ?? "unknown"}`,
    metadata: {
      count: summary.count,
      open,
      nearest_due_by: summary.nearestDueBy,
      dispute_ids: summary.disputeIds,
    },
  });
  return summary;
}

export function evidenceKindOrNull(value: string): EvidenceKind | null {
  return isEvidenceKind(value) ? value : null;
}
