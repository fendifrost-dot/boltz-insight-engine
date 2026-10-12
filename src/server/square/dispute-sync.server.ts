import { getPayment } from "./api.ts";
import { SquareApiError } from "./errors.ts";
import { unwrapResource } from "./events.ts";
import type { SquareHttp } from "./http.ts";
import { mapPayment, type DisputeDraft } from "./map.ts";
import {
  ensureDisputeChecklist,
  linkDisputeIds,
  missingPaymentIds,
  saveDispute,
} from "./dispute-store.server.ts";
import { matchPaymentIds, savePayment } from "./store.server.ts";

/**
 * Upsert one dispute, fill its checklist, and copy the lead from the disputed payment.
 * A missing payment is loaded with GET /v2/payments. Evidence is never submitted.
 * Returns lead ids touched by a newly stored payment.
 */
export async function storeDisputeDraft(
  draft: DisputeDraft,
  http: SquareHttp | null,
): Promise<string[]> {
  await saveDispute(draft);
  await ensureDisputeChecklist(draft.square_id);
  const leads: string[] = [];
  if (draft.payment_id && http) {
    const missing = await missingPaymentIds([draft.payment_id]);
    if (missing.length > 0) {
      try {
        const body = await getPayment(http, draft.payment_id);
        const payment = mapPayment(unwrapResource(body, "payment"));
        if (payment) {
          await savePayment(payment);
          leads.push(...(await matchPaymentIds([payment.square_id])));
        }
      } catch (error) {
        if (!(error instanceof SquareApiError) || (error.status !== 404 && error.status !== 0)) {
          throw error;
        }
      }
    }
  }
  await linkDisputeIds([draft.square_id]);
  return leads;
}
