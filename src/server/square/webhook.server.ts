import { SquareApiError, squareErrorCode } from "./errors.ts";
import { readSquareConfig, webhookSettings } from "./env.server.ts";
import { unwrapResource, type ParsedSquareEvent } from "./events.ts";
import { createSquareHttp, type SquareHttp } from "./http.ts";
import { getCustomer, getInvoice, getOrder, getPayment, getRefund } from "./api.ts";
import {
  mapCustomer,
  mapInvoice,
  mapOrder,
  mapPayment,
  mapRefund,
  type CustomerDraft,
} from "./map.ts";
import { rollupSquareWeeks } from "./rollup.ts";
import { processSquareWebhook } from "./webhook.ts";
import { recordHealth } from "@/server/lead-inbox/store.server";
import {
  claimWebhookEvent,
  finishWebhookEvent,
  loadRollupRows,
  matchCustomerIds,
  matchInvoiceIds,
  matchOrderIds,
  matchPaymentIds,
  refreshLeadForPayment,
  refreshLeadMoney,
  saveCustomer,
  saveInvoice,
  saveOrder,
  savePayment,
  saveRefund,
  writeSalesWeeks,
} from "./store.server.ts";

async function refreshWeeks(): Promise<void> {
  const loaded = await loadRollupRows();
  const weeks = rollupSquareWeeks({
    payments: loaded.payments.map((row) => ({
      status: row.status,
      amountCents: row.amount_cents,
      createdAt: row.created_at_square,
      leadId: row.lead_id,
    })),
    refunds: loaded.refunds.map((row) => ({
      status: row.status,
      amountCents: row.amount_cents,
      createdAt: row.created_at_square,
    })),
    leadSources: loaded.sources,
  });
  await writeSalesWeeks(weeks);
}

async function preferFetched<T>(
  http: SquareHttp | null,
  id: string | null,
  load: ((client: SquareHttp, objectId: string) => Promise<unknown>) | null,
  key: string,
  map: (raw: unknown) => T | null,
  embedded: T | null,
): Promise<T | null> {
  if (http && id && load) {
    try {
      const body = await load(http, id);
      return map(unwrapResource(body, key)) ?? embedded;
    } catch (error) {
      if (!(error instanceof SquareApiError) || (error.status !== 404 && error.status !== 0)) {
        if (!embedded) throw error;
      }
    }
  }
  return embedded;
}

export async function applySquareEvent(event: ParsedSquareEvent): Promise<void> {
  const config = readSquareConfig();
  const http = config.configured
    ? createSquareHttp({ accessToken: config.accessToken, baseUrl: config.baseUrl })
    : null;

  if (event.kind === "customer" && event.deleted && event.objectId) {
    const draft: CustomerDraft = {
      square_id: event.objectId,
      phone_e164: null,
      email: null,
      created_at_square: null,
      updated_at_square: null,
      deleted: true,
    };
    await saveCustomer(draft);
    await matchCustomerIds([event.objectId]);
    return;
  }

  if (event.kind === "payment") {
    const draft = await preferFetched(
      http,
      event.objectId,
      getPayment,
      "payment",
      mapPayment,
      event.payment,
    );
    if (!draft) throw new Error("square_payment_missing");
    await savePayment(draft);
    const leads = await matchPaymentIds([draft.square_id]);
    await refreshLeadMoney(leads);
    await refreshWeeks().catch(() => undefined);
    return;
  }

  if (event.kind === "refund") {
    const draft = await preferFetched(
      http,
      event.objectId,
      getRefund,
      "refund",
      mapRefund,
      event.refund,
    );
    if (!draft) throw new Error("square_refund_missing");
    await saveRefund(draft);
    if (draft.payment_id) await refreshLeadForPayment(draft.payment_id);
    await refreshWeeks().catch(() => undefined);
    return;
  }

  if (event.kind === "order") {
    const draft = await preferFetched(
      http,
      event.objectId,
      getOrder,
      "order",
      mapOrder,
      event.order,
    );
    if (!draft) throw new Error("square_order_missing");
    await saveOrder(draft);
    await matchOrderIds([draft.square_id]);
    return;
  }

  if (event.kind === "invoice") {
    const draft = await preferFetched(
      http,
      event.objectId,
      getInvoice,
      "invoice",
      mapInvoice,
      event.invoice,
    );
    if (!draft) throw new Error("square_invoice_missing");
    await saveInvoice(draft);
    await matchInvoiceIds([draft.square_id]);
    return;
  }

  if (event.kind === "customer") {
    const draft = await preferFetched(
      http,
      event.objectId,
      getCustomer,
      "customer",
      mapCustomer,
      event.customer,
    );
    if (!draft) throw new Error("square_customer_missing");
    await saveCustomer(draft);
    await matchCustomerIds([draft.square_id]);
  }
}

export async function receiveSquareWebhook(request: Request): Promise<Response> {
  const settings = webhookSettings();
  const rawBody = await request.text();
  const result = await processSquareWebhook({
    rawBody,
    signatureHeader: request.headers.get("x-square-hmacsha256-signature"),
    signatureKey: settings.signatureKey,
    notificationUrl: settings.notificationUrl,
    claim: (event) => claimWebhookEvent(event),
    apply: (event) => applySquareEvent(event),
    finish: (eventId, status) => finishWebhookEvent(eventId, status),
  });

  if (result.status === 403 || result.status === 503) {
    await recordHealth({
      provider: "square",
      checkName: result.status === 503 ? "webhook_not_configured" : "webhook_signature_invalid",
      ok: false,
      detail:
        result.status === 503 ? "signature key or notification url missing" : "signature mismatch",
    }).catch(() => undefined);
  } else if (result.status === 200) {
    await recordHealth({
      provider: "square",
      checkName: "webhook_received",
      ok: true,
      detail: result.body["duplicate"] === true ? "duplicate" : "processed",
    }).catch(() => undefined);
  }

  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

export function webhookFailureCode(error: unknown): string {
  return squareErrorCode(error);
}
