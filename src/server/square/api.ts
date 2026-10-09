import type { SquareHttp } from "./http.ts";

export type SquareLocation = {
  id: string;
  status: string;
  name: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cursorOf(body: unknown): string | null {
  const record = asRecord(body);
  const cursor = record?.["cursor"];
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

export async function listLocations(http: SquareHttp): Promise<SquareLocation[]> {
  const body = await http.request("GET", "/v2/locations");
  const record = asRecord(body);
  const rows = record?.["locations"];
  if (!Array.isArray(rows)) return [];
  const locations: SquareLocation[] = [];
  for (const row of rows) {
    const item = asRecord(row);
    const id = item?.["id"];
    if (typeof id !== "string" || id.length === 0) continue;
    const status = item?.["status"];
    const name = item?.["name"];
    locations.push({
      id,
      status: typeof status === "string" ? status : "UNKNOWN",
      name: typeof name === "string" ? name.slice(0, 120) : null,
    });
  }
  return locations;
}

export type LocationChoice = {
  mode: "configured" | "discovered" | "ambiguous" | "none";
  /** The single location the shop is pinned to. Null when we refuse to guess. */
  resolvedLocationId: string | null;
  /** Passed to ListPayments. Undefined means every location. */
  paymentsLocationId: string | undefined;
  /** Each id is searched explicitly. Empty means skip order and invoice search. */
  orderLocationIds: string[];
  active: SquareLocation[];
};

export function resolveLocations(args: {
  configuredId: string | null;
  locations: SquareLocation[];
}): LocationChoice {
  const active = args.locations.filter((location) => location.status === "ACTIVE");
  if (args.configuredId) {
    return {
      mode: "configured",
      resolvedLocationId: args.configuredId,
      paymentsLocationId: args.configuredId,
      orderLocationIds: [args.configuredId],
      active,
    };
  }
  if (active.length === 1) {
    const only = active[0]!;
    return {
      mode: "discovered",
      resolvedLocationId: only.id,
      paymentsLocationId: only.id,
      orderLocationIds: [only.id],
      active,
    };
  }
  if (active.length === 0) {
    return {
      mode: "none",
      resolvedLocationId: null,
      paymentsLocationId: undefined,
      orderLocationIds: [],
      active,
    };
  }
  return {
    mode: "ambiguous",
    resolvedLocationId: null,
    paymentsLocationId: undefined,
    orderLocationIds: active.map((location) => location.id),
    active,
  };
}

export async function listPayments(
  http: SquareHttp,
  query: { beginTime: string; cursor?: string; locationId?: string; limit?: number },
): Promise<{ payments: unknown[]; cursor: string | null }> {
  const body = await http.request("GET", "/v2/payments", {
    query: {
      begin_time: query.beginTime,
      cursor: query.cursor,
      location_id: query.locationId,
      limit: String(query.limit ?? 100),
      sort_order: "ASC",
    },
  });
  const record = asRecord(body);
  const payments = record?.["payments"];
  return { payments: Array.isArray(payments) ? payments : [], cursor: cursorOf(body) };
}

export async function listRefunds(
  http: SquareHttp,
  query: { beginTime: string; cursor?: string; locationId?: string; limit?: number },
): Promise<{ refunds: unknown[]; cursor: string | null }> {
  const body = await http.request("GET", "/v2/refunds", {
    query: {
      begin_time: query.beginTime,
      cursor: query.cursor,
      location_id: query.locationId,
      limit: String(query.limit ?? 100),
      sort_order: "ASC",
    },
  });
  const record = asRecord(body);
  const refunds = record?.["refunds"];
  return { refunds: Array.isArray(refunds) ? refunds : [], cursor: cursorOf(body) };
}

export async function searchOrders(
  http: SquareHttp,
  args: { locationId: string; beginTime: string; cursor?: string },
): Promise<{ orders: unknown[]; cursor: string | null }> {
  const body = await http.request("POST", "/v2/orders/search", {
    body: {
      location_ids: [args.locationId],
      limit: 100,
      cursor: args.cursor,
      query: {
        filter: {
          date_time_filter: { updated_at: { start_at: args.beginTime } },
          state_filter: { states: ["OPEN", "COMPLETED", "CANCELED", "DRAFT"] },
        },
        sort: { sort_field: "UPDATED_AT", sort_order: "ASC" },
      },
    },
  });
  const record = asRecord(body);
  const orders = record?.["orders"];
  return { orders: Array.isArray(orders) ? orders : [], cursor: cursorOf(body) };
}

export async function searchInvoices(
  http: SquareHttp,
  args: { locationId: string; cursor?: string },
): Promise<{ invoices: unknown[]; cursor: string | null }> {
  const body = await http.request("POST", "/v2/invoices/search", {
    body: {
      limit: 100,
      cursor: args.cursor,
      query: {
        filter: { location_ids: [args.locationId] },
        sort: { field: "INVOICE_SORT_DATE", order: "DESC" },
      },
    },
  });
  const record = asRecord(body);
  const invoices = record?.["invoices"];
  return { invoices: Array.isArray(invoices) ? invoices : [], cursor: cursorOf(body) };
}

export async function searchCustomers(
  http: SquareHttp,
  args: { beginTime: string; cursor?: string },
): Promise<{ customers: unknown[]; cursor: string | null }> {
  const body = await http.request("POST", "/v2/customers/search", {
    body: {
      limit: 100,
      cursor: args.cursor,
      query: { filter: { updated_at: { start_at: args.beginTime } } },
    },
  });
  const record = asRecord(body);
  const customers = record?.["customers"];
  return { customers: Array.isArray(customers) ? customers : [], cursor: cursorOf(body) };
}

export async function listCatalog(
  http: SquareHttp,
  cursor?: string,
): Promise<{ objects: unknown[]; cursor: string | null }> {
  const body = await http.request("GET", "/v2/catalog/list", {
    query: { types: "ITEM,ITEM_VARIATION,CATEGORY", cursor },
  });
  const record = asRecord(body);
  const objects = record?.["objects"];
  return { objects: Array.isArray(objects) ? objects : [], cursor: cursorOf(body) };
}

const ID_RE = /^[A-Za-z0-9_-]{1,192}$/;

function objectId(id: string): string {
  if (!ID_RE.test(id)) throw new Error("square_id_invalid");
  return id;
}

export async function getPayment(http: SquareHttp, id: string): Promise<unknown> {
  return http.request("GET", `/v2/payments/${objectId(id)}`);
}

export async function getRefund(http: SquareHttp, id: string): Promise<unknown> {
  return http.request("GET", `/v2/refunds/${objectId(id)}`);
}

export async function getOrder(http: SquareHttp, id: string): Promise<unknown> {
  return http.request("GET", `/v2/orders/${objectId(id)}`);
}

export async function getInvoice(http: SquareHttp, id: string): Promise<unknown> {
  return http.request("GET", `/v2/invoices/${objectId(id)}`);
}

export async function getCustomer(http: SquareHttp, id: string): Promise<unknown> {
  return http.request("GET", `/v2/customers/${objectId(id)}`);
}
