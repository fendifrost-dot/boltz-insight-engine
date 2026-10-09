import {
  mapCustomer,
  mapInvoice,
  mapOrder,
  mapPayment,
  mapRefund,
  isRecord,
  type CustomerDraft,
  type InvoiceDraft,
  type OrderDraft,
  type PaymentDraft,
  type RefundDraft,
} from "./map.ts";

export type SquareEventKind = "payment" | "refund" | "order" | "invoice" | "customer" | "other";

export type ParsedSquareEvent = {
  eventId: string;
  eventType: string;
  objectId: string | null;
  kind: SquareEventKind;
  deleted: boolean;
  payment: PaymentDraft | null;
  refund: RefundDraft | null;
  order: OrderDraft | null;
  invoice: InvoiceDraft | null;
  customer: CustomerDraft | null;
};

const KINDS: Record<string, SquareEventKind> = {
  payment: "payment",
  refund: "refund",
  order: "order",
  invoice: "invoice",
  customer: "customer",
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function nested(object: Record<string, unknown>, key: string): unknown {
  return object[key];
}

export function parseSquareNotification(payload: unknown): ParsedSquareEvent | null {
  if (!isRecord(payload)) return null;
  const eventId = text(payload["event_id"], 128);
  const eventType = text(payload["type"], 80);
  if (!eventId || !eventType) return null;
  const data = isRecord(payload["data"]) ? payload["data"] : null;
  const object = data && isRecord(data["object"]) ? data["object"] : null;
  const prefix = eventType.split(".")[0] ?? "";
  const kind = KINDS[prefix] ?? "other";
  const deleted = eventType.endsWith(".deleted");

  let objectId = data ? text(data["id"], 192) : null;
  let payment: PaymentDraft | null = null;
  let refund: RefundDraft | null = null;
  let order: OrderDraft | null = null;
  let invoice: InvoiceDraft | null = null;
  let customer: CustomerDraft | null = null;

  if (object) {
    payment = mapPayment(nested(object, "payment"));
    refund = mapRefund(nested(object, "refund"));
    order = mapOrder(nested(object, "order"));
    invoice = mapInvoice(nested(object, "invoice"));
    customer = mapCustomer(nested(object, "customer"));
    if (!order) {
      const updated = isRecord(object["order_updated"]) ? object["order_updated"] : null;
      const created = isRecord(object["order_created"]) ? object["order_created"] : null;
      const hint = updated ?? created;
      if (hint) {
        objectId = text(hint["order_id"], 192) ?? objectId;
        const state = text(hint["state"], 32);
        if (objectId && state) {
          order = {
            square_id: objectId,
            location_id: text(hint["location_id"], 64),
            customer_id: null,
            state,
            total_cents: null,
            currency: null,
            created_at_square: null,
            updated_at_square: null,
            line_items: [],
          };
        }
      }
    }
  }

  if (!objectId) {
    objectId =
      payment?.square_id ??
      refund?.square_id ??
      order?.square_id ??
      invoice?.square_id ??
      customer?.square_id ??
      null;
  }
  if (customer && deleted) customer = { ...customer, deleted: true, phone_e164: null, email: null };

  return { eventId, eventType, objectId, kind, deleted, payment, refund, order, invoice, customer };
}

export function unwrapResource(body: unknown, key: string): unknown {
  if (!isRecord(body)) return null;
  return body[key] ?? null;
}
