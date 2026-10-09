import { recordHealth } from "@/server/lead-inbox/store.server";
import {
  listCatalog,
  listLocations,
  listPayments,
  listRefunds,
  resolveLocations,
  searchCustomers,
  searchInvoices,
  searchOrders,
  type LocationChoice,
} from "./api.ts";
import { createSquareHttp, collectCursorPages } from "./http.ts";
import {
  mapCatalog,
  mapCustomer,
  mapInvoice,
  mapOrder,
  mapPayment,
  mapRefund,
  type CatalogDraft,
  type CustomerDraft,
  type InvoiceDraft,
  type OrderDraft,
  type PaymentDraft,
  type RefundDraft,
} from "./map.ts";
import { readSquareConfig } from "./env.server.ts";
import { squareErrorCode } from "./errors.ts";
import { rollupSquareWeeks, syncBeginIso } from "./rollup.ts";
import {
  matchCustomerIds,
  matchInvoiceIds,
  matchOrderIds,
  matchPaymentIds,
  loadRollupRows,
  readSyncState,
  refreshLeadMoney,
  saveCatalog,
  saveCustomer,
  saveInvoice,
  saveOrder,
  savePayment,
  saveRefund,
  writeSalesWeeks,
  writeSyncState,
} from "./store.server.ts";

const MAX_PAGES = 100;

export type SyncReport =
  | { configured: false; reason: string }
  | {
      configured: true;
      mode: "incremental" | "backfill";
      since: string | null;
      locationMode: LocationChoice["mode"];
      resolvedLocationId: string | null;
      activeLocations: { id: string; status: string }[];
      counts: Record<string, number>;
      truncated: string[];
      matchedLeads: number;
      paidUpdates: number;
      weeks: number;
      errors: { resource: string; code: string }[];
      salesWeekly: "updated" | "failed" | "skipped";
    };

async function pages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; cursor: string | null }>,
): Promise<{ items: T[]; truncated: boolean }> {
  return collectCursorPages({ maxPages: MAX_PAGES, load });
}

export async function runSquareSync(args: {
  mode: "incremental" | "backfill";
  since: string | null;
  now?: Date;
}): Promise<SyncReport> {
  const config = readSquareConfig();
  if (!config.configured) return { configured: false, reason: config.reason };

  const now = args.now ?? new Date();
  const http = createSquareHttp({
    accessToken: config.accessToken,
    baseUrl: config.baseUrl,
  });
  const locations = await listLocations(http);
  const choice = resolveLocations({ configuredId: config.locationId, locations });
  await writeSyncState({
    resource: "locations",
    started: true,
    cursor: choice.resolvedLocationId,
    lastCount: choice.active.length,
    lastSuccessAt: now.toISOString(),
    lastError:
      choice.mode === "ambiguous"
        ? "multiple_active_locations"
        : choice.mode === "none"
          ? "no_active_location"
          : null,
    syncedThrough: now.toISOString(),
  });

  const counts: Record<string, number> = {};
  const truncated: string[] = [];
  const errors: { resource: string; code: string }[] = [];
  const leadIds = new Set<string>();

  const beginFor = async (resource: string): Promise<string> => {
    const state = await readSyncState(resource);
    return syncBeginIso({
      mode: args.mode,
      sinceDate: args.since,
      syncedThrough: state?.synced_through ?? null,
      now,
    });
  };

  const guard = async (
    resource: string,
    fn: () => Promise<{ count: number; truncated: boolean }>,
  ) => {
    await writeSyncState({ resource, started: true, lastError: null });
    try {
      const result = await fn();
      if (result.truncated) truncated.push(resource);
      counts[resource] = result.count;
      await writeSyncState({
        resource,
        lastCount: result.count,
        lastSuccessAt: new Date().toISOString(),
        syncedThrough: now.toISOString(),
        lastError: result.truncated ? "truncated" : null,
        cursor: null,
      });
    } catch (error) {
      const code = squareErrorCode(error);
      counts[resource] = counts[resource] ?? 0;
      errors.push({ resource, code });
      await writeSyncState({ resource, lastError: code }).catch(() => undefined);
    }
  };

  await guard("customers", async () => {
    const begin = await beginFor("customers");
    const page = await pages(async (cursor) => {
      const body = await searchCustomers(http, { beginTime: begin, ...(cursor ? { cursor } : {}) });
      return { items: body.customers, cursor: body.cursor };
    });
    const drafts = page.items.map(mapCustomer).filter((row): row is CustomerDraft => row !== null);
    for (const draft of drafts) await saveCustomer(draft);
    for (const chunk of chunksOf(drafts.map((draft) => draft.square_id))) {
      await matchCustomerIds(chunk);
    }
    return { count: drafts.length, truncated: page.truncated };
  });

  await guard("payments", async () => {
    const begin = await beginFor("payments");
    const page = await pages(async (cursor) => {
      const body = await listPayments(http, {
        beginTime: begin,
        ...(cursor ? { cursor } : {}),
        ...(choice.paymentsLocationId ? { locationId: choice.paymentsLocationId } : {}),
      });
      return { items: body.payments, cursor: body.cursor };
    });
    const drafts = page.items.map(mapPayment).filter((row): row is PaymentDraft => row !== null);
    for (const draft of drafts) await savePayment(draft);
    for (const chunk of chunksOf(drafts.map((draft) => draft.square_id))) {
      for (const leadId of await matchPaymentIds(chunk)) leadIds.add(leadId);
    }
    return { count: drafts.length, truncated: page.truncated };
  });

  await guard("refunds", async () => {
    const begin = await beginFor("refunds");
    const page = await pages(async (cursor) => {
      const body = await listRefunds(http, {
        beginTime: begin,
        ...(cursor ? { cursor } : {}),
        ...(choice.paymentsLocationId ? { locationId: choice.paymentsLocationId } : {}),
      });
      return { items: body.refunds, cursor: body.cursor };
    });
    const drafts = page.items.map(mapRefund).filter((row): row is RefundDraft => row !== null);
    for (const draft of drafts) await saveRefund(draft);
    return { count: drafts.length, truncated: page.truncated };
  });

  await guard("orders", async () => {
    if (choice.orderLocationIds.length === 0) {
      return { count: 0, truncated: false };
    }
    const begin = await beginFor("orders");
    const drafts: OrderDraft[] = [];
    let truncatedOrders = false;
    for (const locationId of choice.orderLocationIds) {
      const page = await pages(async (cursor) => {
        const body = await searchOrders(http, {
          locationId,
          beginTime: begin,
          ...(cursor ? { cursor } : {}),
        });
        return { items: body.orders, cursor: body.cursor };
      });
      truncatedOrders = truncatedOrders || page.truncated;
      for (const raw of page.items) {
        const draft = mapOrder(raw);
        if (draft) drafts.push(draft);
      }
    }
    for (const draft of drafts) await saveOrder(draft);
    for (const chunk of chunksOf(drafts.map((draft) => draft.square_id))) {
      await matchOrderIds(chunk);
    }
    return { count: drafts.length, truncated: truncatedOrders };
  });

  await guard("invoices", async () => {
    if (choice.orderLocationIds.length === 0) return { count: 0, truncated: false };
    const begin = await beginFor("invoices");
    const drafts: InvoiceDraft[] = [];
    let truncatedInvoices = false;
    for (const locationId of choice.orderLocationIds) {
      const page = await pages(async (cursor) => {
        const body = await searchInvoices(http, { locationId, ...(cursor ? { cursor } : {}) });
        return { items: body.invoices, cursor: body.cursor };
      });
      truncatedInvoices = truncatedInvoices || page.truncated;
      for (const raw of page.items) {
        const draft = mapInvoice(raw);
        if (!draft) continue;
        const stamp = draft.updated_at_square ?? draft.created_at_square;
        if (stamp && stamp < begin) continue;
        drafts.push(draft);
      }
    }
    for (const draft of drafts) await saveInvoice(draft);
    for (const chunk of chunksOf(drafts.map((draft) => draft.square_id))) {
      await matchInvoiceIds(chunk);
    }
    return { count: drafts.length, truncated: truncatedInvoices };
  });

  await guard("catalog", async () => {
    const page = await pages(async (cursor) => {
      const body = cursor ? await listCatalog(http, cursor) : await listCatalog(http);
      return { items: body.objects, cursor: body.cursor };
    });
    const drafts = page.items.map(mapCatalog).filter((row): row is CatalogDraft => row !== null);
    await saveCatalog(drafts);
    return { count: drafts.length, truncated: page.truncated };
  });

  const paidUpdates = await refreshLeadMoney([...leadIds]);
  let weeks = 0;
  let salesWeekly: "updated" | "failed" | "skipped" = "skipped";
  try {
    const loaded = await loadRollupRows();
    const rollup = rollupSquareWeeks({
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
    await writeSalesWeeks(rollup);
    weeks = rollup.length;
    salesWeekly = "updated";
  } catch (error) {
    salesWeekly = "failed";
    errors.push({ resource: "sales_weekly", code: squareErrorCode(error) });
  }

  const detail = `payments ${counts["payments"] ?? 0} refunds ${counts["refunds"] ?? 0} orders ${counts["orders"] ?? 0} invoices ${counts["invoices"] ?? 0} customers ${counts["customers"] ?? 0} catalog ${counts["catalog"] ?? 0} paid ${paidUpdates}`;
  await recordHealth({
    provider: "square",
    checkName: args.mode === "backfill" ? "backfill" : "incremental_sync",
    ok: errors.length === 0,
    detail,
    metadata: {
      location_mode: choice.mode,
      active_locations: choice.active.length,
      truncated,
      errors: errors.map((error) => error.resource),
    },
  }).catch(() => undefined);

  return {
    configured: true,
    mode: args.mode,
    since: args.since,
    locationMode: choice.mode,
    resolvedLocationId: choice.resolvedLocationId,
    activeLocations: choice.active.map((location) => ({
      id: location.id,
      status: location.status,
    })),
    counts,
    truncated,
    matchedLeads: leadIds.size,
    paidUpdates,
    weeks,
    errors,
    salesWeekly,
  };
}

function chunksOf(ids: string[]): string[][] {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 200)
    chunks.push(unique.slice(index, index + 200));
  return chunks;
}
