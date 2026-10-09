import { emailKey, phoneE164 } from "./normalize.ts";

export type PaymentDraft = {
  square_id: string;
  location_id: string | null;
  customer_id: string | null;
  order_id: string | null;
  status: string;
  amount_cents: number | null;
  currency: string | null;
  refunded_cents: number | null;
  tip_cents: number | null;
  fee_cents: number | null;
  source_type: string | null;
  card_brand: string | null;
  card_last4: string | null;
  buyer_phone_e164: string | null;
  buyer_email: string | null;
  created_at_square: string | null;
  updated_at_square: string | null;
};

export type RefundDraft = {
  square_id: string;
  payment_id: string | null;
  order_id: string | null;
  location_id: string | null;
  status: string;
  amount_cents: number | null;
  currency: string | null;
  created_at_square: string | null;
  updated_at_square: string | null;
};

export type LineDraft = {
  line_uid: string;
  name: string | null;
  quantity: string | null;
  gross_cents: number | null;
  catalog_object_id: string | null;
};

export type OrderDraft = {
  square_id: string;
  location_id: string | null;
  customer_id: string | null;
  state: string;
  total_cents: number | null;
  currency: string | null;
  created_at_square: string | null;
  updated_at_square: string | null;
  line_items: LineDraft[];
};

export type InvoiceDraft = {
  square_id: string;
  order_id: string | null;
  customer_id: string | null;
  location_id: string | null;
  status: string;
  invoice_number: string | null;
  amount_cents: number | null;
  currency: string | null;
  recipient_phone_e164: string | null;
  recipient_email: string | null;
  created_at_square: string | null;
  updated_at_square: string | null;
};

export type CustomerDraft = {
  square_id: string;
  phone_e164: string | null;
  email: string | null;
  created_at_square: string | null;
  updated_at_square: string | null;
  deleted: boolean;
};

export type CatalogDraft = {
  square_id: string;
  item_type: string;
  name: string | null;
  updated_at_square: string | null;
  is_deleted: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function timestamp(value: unknown): string | null {
  const raw = text(value, 40);
  if (!raw || !Number.isFinite(Date.parse(raw))) return null;
  return new Date(Date.parse(raw)).toISOString();
}

/** Cents when amount_money is present. Null when the field was omitted (partial webhook). */
export function moneyCents(value: unknown): number | null {
  if (!isRecord(value) || !("amount" in value)) return null;
  const amount = value["amount"];
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function currencyOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const currency = text(value["currency"], 3);
  return currency ? currency.toUpperCase() : null;
}

function cardFields(payment: Record<string, unknown>): {
  brand: string | null;
  last4: string | null;
} {
  const details = isRecord(payment["card_details"]) ? payment["card_details"] : null;
  const card = details && isRecord(details["card"]) ? details["card"] : null;
  if (!card) return { brand: null, last4: null };
  const last4 = text(card["last_4"], 4);
  return {
    brand: text(card["card_brand"], 32),
    last4: last4 && /^[0-9]{4}$/.test(last4) ? last4 : null,
  };
}

function feeCents(payment: Record<string, unknown>): number | null {
  const fees = payment["processing_fee"];
  if (!Array.isArray(fees)) return null;
  let total = 0;
  for (const fee of fees) {
    if (!isRecord(fee)) continue;
    const cents = moneyCents(fee["amount_money"]);
    if (cents !== null) total += cents;
  }
  return total;
}

export function mapPayment(raw: unknown): PaymentDraft | null {
  if (!isRecord(raw)) return null;
  const id = text(raw["id"], 192);
  const status = text(raw["status"], 32);
  if (!id || !status) return null;
  const card = cardFields(raw);
  const amount = moneyCents(raw["amount_money"]);
  return {
    square_id: id,
    location_id: text(raw["location_id"], 64),
    customer_id: text(raw["customer_id"], 192),
    order_id: text(raw["order_id"], 192),
    status,
    amount_cents: amount,
    currency: currencyOf(raw["amount_money"]),
    refunded_cents: moneyCents(raw["refunded_money"]),
    tip_cents: moneyCents(raw["tip_money"]),
    fee_cents: feeCents(raw),
    source_type: text(raw["source_type"], 32),
    card_brand: card.brand,
    card_last4: card.last4,
    buyer_phone_e164: phoneE164(text(raw["buyer_phone_number"], 40)),
    buyer_email: emailKey(text(raw["buyer_email_address"], 320)),
    created_at_square: timestamp(raw["created_at"]),
    updated_at_square: timestamp(raw["updated_at"]),
  };
}

export function mapRefund(raw: unknown): RefundDraft | null {
  if (!isRecord(raw)) return null;
  const id = text(raw["id"], 192);
  const status = text(raw["status"], 32);
  if (!id || !status) return null;
  return {
    square_id: id,
    payment_id: text(raw["payment_id"], 192),
    order_id: text(raw["order_id"], 192),
    location_id: text(raw["location_id"], 64),
    status,
    amount_cents: moneyCents(raw["amount_money"]),
    currency: currencyOf(raw["amount_money"]),
    created_at_square: timestamp(raw["created_at"]),
    updated_at_square: timestamp(raw["updated_at"]),
  };
}

export function mapOrder(raw: unknown): OrderDraft | null {
  if (!isRecord(raw)) return null;
  const id = text(raw["id"], 192);
  const state = text(raw["state"], 32);
  if (!id || !state) return null;
  const total = moneyCents(raw["total_money"]);
  const lines: LineDraft[] = [];
  const rawLines = raw["line_items"];
  if (Array.isArray(rawLines)) {
    rawLines.forEach((line, index) => {
      if (!isRecord(line)) return;
      const uid = text(line["uid"], 80) ?? `line-${index}`;
      const gross = moneyCents(line["gross_sales_money"]) ?? moneyCents(line["total_money"]);
      lines.push({
        line_uid: uid,
        name: text(line["name"], 200),
        quantity: text(line["quantity"], 32),
        gross_cents: gross,
        catalog_object_id: text(line["catalog_object_id"], 192),
      });
    });
  }
  return {
    square_id: id,
    location_id: text(raw["location_id"], 64),
    customer_id: text(raw["customer_id"], 192),
    state,
    total_cents: total,
    currency: currencyOf(raw["total_money"]),
    created_at_square: timestamp(raw["created_at"]),
    updated_at_square: timestamp(raw["updated_at"]),
    line_items: lines,
  };
}

export function mapInvoice(raw: unknown): InvoiceDraft | null {
  if (!isRecord(raw)) return null;
  const id = text(raw["id"], 192);
  const status = text(raw["status"], 32);
  if (!id || !status) return null;
  const recipient = isRecord(raw["primary_recipient"]) ? raw["primary_recipient"] : null;
  let amount: number | null = null;
  let currency: string | null = null;
  const requests = raw["payment_requests"];
  if (Array.isArray(requests)) {
    let sum = 0;
    let saw = false;
    for (const request of requests) {
      if (!isRecord(request)) continue;
      const cents = moneyCents(request["computed_amount_money"]);
      if (cents === null) continue;
      saw = true;
      sum += cents;
      currency = currency ?? currencyOf(request["computed_amount_money"]);
    }
    if (saw) amount = sum;
  }
  return {
    square_id: id,
    order_id: text(raw["order_id"], 192),
    customer_id: recipient ? text(recipient["customer_id"], 192) : null,
    location_id: text(raw["location_id"], 64),
    status,
    invoice_number: text(raw["invoice_number"], 64),
    amount_cents: amount,
    currency,
    recipient_phone_e164: phoneE164(recipient ? text(recipient["phone_number"], 40) : null),
    recipient_email: emailKey(recipient ? text(recipient["email_address"], 320) : null),
    created_at_square: timestamp(raw["created_at"]),
    updated_at_square: timestamp(raw["updated_at"]),
  };
}

export function mapCustomer(raw: unknown): CustomerDraft | null {
  if (!isRecord(raw)) return null;
  const id = text(raw["id"], 192);
  if (!id) return null;
  return {
    square_id: id,
    phone_e164: phoneE164(text(raw["phone_number"], 40)),
    email: emailKey(text(raw["email_address"], 320)),
    created_at_square: timestamp(raw["created_at"]),
    updated_at_square: timestamp(raw["updated_at"]),
    deleted: false,
  };
}

export function mapCatalog(raw: unknown): CatalogDraft | null {
  if (!isRecord(raw)) return null;
  const id = text(raw["id"], 192);
  const itemType = text(raw["type"], 40);
  if (!id || !itemType) return null;
  const itemData = isRecord(raw["item_data"]) ? raw["item_data"] : null;
  const variation = isRecord(raw["item_variation_data"]) ? raw["item_variation_data"] : null;
  const category = isRecord(raw["category_data"]) ? raw["category_data"] : null;
  const name =
    text(itemData?.["name"], 200) ??
    text(variation?.["name"], 200) ??
    text(category?.["name"], 200);
  return {
    square_id: id,
    item_type: itemType,
    name,
    updated_at_square: timestamp(raw["updated_at"]),
    is_deleted: raw["is_deleted"] === true,
  };
}

/** Keys that must never be copied onto a stored payment row. */
export const DROPPED_CARD_KEYS = [
  "fingerprint",
  "exp_month",
  "exp_year",
  "cardholder_name",
  "pan",
] as const;
