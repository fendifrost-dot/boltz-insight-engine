export type PublicPayment = {
  squareId: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  createdAt: string | null;
  leadId: string | null;
  matchStatus: string;
  cardBrand: string | null;
  cardLast4: string | null;
  orderId: string | null;
};

export const PUBLIC_PAYMENT_KEYS = [
  "squareId",
  "status",
  "amountCents",
  "refundedCents",
  "currency",
  "createdAt",
  "leadId",
  "matchStatus",
  "cardBrand",
  "cardLast4",
  "orderId",
] as const;

export function toPublicPayment(row: {
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
}): PublicPayment {
  return {
    squareId: row.square_id,
    status: row.status,
    amountCents: row.amount_cents,
    refundedCents: row.refunded_cents,
    currency: row.currency,
    createdAt: row.created_at_square,
    leadId: row.lead_id,
    matchStatus: row.match_status,
    cardBrand: row.card_brand,
    cardLast4: row.card_last4,
    orderId: row.order_id,
  };
}
