import { createHash } from "node:crypto";
import { listLocations, resolveLocations, type SquareLocation } from "./api.ts";
import {
  displayApplicationId,
  readSquareConfig,
  squareEnvironment,
  squareNotificationUrl,
  squareSecretStatus,
  type SquareConfig,
} from "./env.server.ts";
import { squareErrorCode } from "./errors.ts";
import { createSquareHttp } from "./http.ts";
import { squarePaymentsRequest, squareRevenueRequest } from "./bot-schema.ts";
import { toPublicPayment, type PublicPayment } from "./public.ts";
import { rollupSquareWeeks, type WeekRollup } from "./rollup.ts";
import {
  listPaymentsForRead,
  listSyncStates,
  loadRollupRows,
  type SyncStateRow,
} from "./store.server.ts";

export type SquareSecretFlag = {
  name: string;
  configured: boolean;
  optional: boolean;
  masked: string | null;
};

export type SquareDashboard = {
  configured: boolean;
  reason: string | null;
  environment: "sandbox" | "production" | null;
  applicationId: string | null;
  signatureConfigured: boolean;
  webhookUrl: string | null;
  locationMode: "configured" | "discovered" | "ambiguous" | "none" | "unset";
  resolvedLocationId: string | null;
  locations: SquareLocation[];
  locationError: string | null;
  storageError: string | null;
  sync: {
    resource: string;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastCount: number;
    cursor: string | null;
  }[];
  weeks: WeekRollup[];
  unmatched: PublicPayment[];
  secrets: SquareSecretFlag[];
};

let locationCache: { at: number; tokenHash: string; locations: SquareLocation[] } | null = null;

async function discoverLocations(
  config: Extract<SquareConfig, { configured: true }>,
): Promise<{ locations: SquareLocation[]; error: string | null }> {
  const tokenHash = createHash("sha256").update(config.accessToken).digest("hex").slice(0, 16);
  if (
    locationCache &&
    locationCache.tokenHash === tokenHash &&
    Date.now() - locationCache.at < 60_000
  ) {
    return { locations: locationCache.locations, error: null };
  }
  try {
    const http = createSquareHttp({
      accessToken: config.accessToken,
      baseUrl: config.baseUrl,
      maxAttempts: 2,
    });
    const locations = await listLocations(http);
    locationCache = { at: Date.now(), tokenHash, locations };
    return { locations, error: null };
  } catch (error) {
    return { locations: [], error: squareErrorCode(error) };
  }
}

function secretFlags(): SquareSecretFlag[] {
  return squareSecretStatus().map((row) => ({
    name: row.name,
    configured: row.configured,
    optional: row.optional,
    masked: row.masked,
  }));
}

function emptyDashboard(reason: string | null, configured: boolean): SquareDashboard {
  const secrets = secretFlags();
  const environment = squareEnvironment();
  return {
    configured,
    reason,
    environment: environment.ok ? environment.value : null,
    applicationId: secrets.find((row) => row.name === "SQUARE_APPLICATION_ID")?.masked ?? null,
    signatureConfigured:
      secrets.find((row) => row.name === "SQUARE_WEBHOOK_SIGNATURE_KEY")?.configured ?? false,
    webhookUrl: squareNotificationUrl(),
    locationMode: "unset",
    resolvedLocationId: null,
    locations: [],
    locationError: null,
    storageError: null,
    sync: [],
    weeks: [],
    unmatched: [],
    secrets,
  };
}

export async function squareDashboard(): Promise<SquareDashboard> {
  const config = readSquareConfig();
  if (!config.configured) return emptyDashboard(config.reason, false);

  const dashboard = emptyDashboard(null, true);
  dashboard.applicationId = displayApplicationId(config.applicationId, config.accessToken);
  const discovered = await discoverLocations(config);
  dashboard.locations = discovered.locations;
  dashboard.locationError = discovered.error;
  if (!discovered.error) {
    const choice = resolveLocations({
      configuredId: config.locationId,
      locations: discovered.locations,
    });
    dashboard.locationMode = choice.mode;
    dashboard.resolvedLocationId = choice.resolvedLocationId;
  }

  try {
    const states = await listSyncStates();
    dashboard.sync = states.map(publicSync);
    const loaded = await loadRollupRows();
    dashboard.weeks = rollupSquareWeeks({
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
    }).slice(0, 12);
    const unmatched = await listPaymentsForRead({ unmatchedOnly: true, limit: 25 });
    dashboard.unmatched = unmatched.map(toPublicPayment);
  } catch (error) {
    dashboard.storageError = squareErrorCode(error);
  }
  return dashboard;
}

function publicSync(row: SyncStateRow) {
  return {
    resource: row.resource,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    lastCount: row.last_count,
    cursor: row.resource === "locations" ? row.cursor : null,
  };
}

export async function squareMcpHealth(): Promise<{
  configured: boolean;
  environment: "sandbox" | "production" | null;
  applicationId: string | null;
  signatureConfigured: boolean;
  locationMode: string | null;
  resolvedLocationId: string | null;
  activeLocationCount: number;
  lastSyncAt: string | null;
  secrets: { name: string; configured: boolean }[];
}> {
  const config = readSquareConfig();
  const secrets = secretFlags().map((row) => ({ name: row.name, configured: row.configured }));
  const environment = squareEnvironment();
  if (!config.configured) {
    return {
      configured: false,
      environment: environment.ok ? environment.value : null,
      applicationId:
        secretFlags().find((row) => row.name === "SQUARE_APPLICATION_ID")?.masked ?? null,
      signatureConfigured: Boolean(
        secretFlags().find((row) => row.name === "SQUARE_WEBHOOK_SIGNATURE_KEY")?.configured,
      ),
      locationMode: null,
      resolvedLocationId: null,
      activeLocationCount: 0,
      lastSyncAt: null,
      secrets,
    };
  }

  let states: SyncStateRow[] = [];
  try {
    states = await listSyncStates();
  } catch {
    states = [];
  }
  const locations = states.find((row) => row.resource === "locations");
  const lastSyncAt =
    states
      .filter((row) => row.resource !== "locations")
      .map((row) => row.last_success_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  let locationMode: string | null = null;
  if (locations?.last_error === "multiple_active_locations") locationMode = "ambiguous";
  else if (locations?.last_error === "no_active_location") locationMode = "none";
  else if (locations?.cursor) locationMode = "resolved";
  else if (locations) locationMode = "unknown";

  return {
    configured: true,
    environment: config.environment,
    applicationId: displayApplicationId(config.applicationId, config.accessToken),
    signatureConfigured: Boolean(config.signatureKey),
    locationMode,
    resolvedLocationId: locations?.cursor ?? null,
    activeLocationCount: locations?.last_count ?? 0,
    lastSyncAt,
    secrets,
  };
}

export async function readSquareRevenue(args: {
  since?: string | null;
  until?: string | null;
}): Promise<
  | { configured: false; reason: string }
  | { configured: true; weeks: WeekRollup[]; totals: WeekRollupTotals }
  | { configured: true; error: string }
> {
  const config = readSquareConfig();
  if (!config.configured) return { configured: false, reason: config.reason };
  try {
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
      since: args.since ?? null,
      until: args.until ?? null,
    });
    return { configured: true, weeks, totals: totalsOf(weeks) };
  } catch (error) {
    return { configured: true, error: squareErrorCode(error) };
  }
}

export type WeekRollupTotals = {
  grossCents: number;
  refundCents: number;
  netCents: number;
  ticketCount: number;
};

function totalsOf(weeks: WeekRollup[]): WeekRollupTotals {
  return weeks.reduce(
    (sum, week) => ({
      grossCents: sum.grossCents + week.grossCents,
      refundCents: sum.refundCents + week.refundCents,
      netCents: sum.netCents + week.netCents,
      ticketCount: sum.ticketCount + week.ticketCount,
    }),
    { grossCents: 0, refundCents: 0, netCents: 0, ticketCount: 0 },
  );
}

export async function readSquarePayments(args: {
  leadId?: string | null;
  limit?: number;
}): Promise<
  | { configured: false; reason: string }
  | { configured: true; payments: PublicPayment[] }
  | { configured: true; error: string }
> {
  const config = readSquareConfig();
  if (!config.configured) return { configured: false, reason: config.reason };
  try {
    const query: { limit: number; leadId?: string } = { limit: args.limit ?? 20 };
    if (args.leadId) query.leadId = args.leadId;
    const rows = await listPaymentsForRead(query);
    return { configured: true, payments: rows.map(toPublicPayment) };
  } catch (error) {
    return { configured: true, error: squareErrorCode(error) };
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleSquareBotAction(payload: unknown): Promise<Response> {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { action?: unknown })
      : null;
  const action = record?.action;
  if (action === "square_revenue") {
    const parsed = squareRevenueRequest.safeParse(payload);
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    if (parsed.data.since && parsed.data.until && parsed.data.since > parsed.data.until) {
      return json({ error: "since must be on or before until" }, 400);
    }
    const result = await readSquareRevenue({
      since: parsed.data.since ?? null,
      until: parsed.data.until ?? null,
    });
    if (!result.configured) return json({ configured: false, reason: result.reason }, 503);
    if ("error" in result) return json({ configured: true, error: result.error }, 503);
    return json(result);
  }
  if (action === "square_payments") {
    const parsed = squarePaymentsRequest.safeParse(payload);
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const result = await readSquarePayments({
      leadId: parsed.data.leadId ?? null,
      limit: parsed.data.limit ?? 20,
    });
    if (!result.configured) return json({ configured: false, reason: result.reason }, 503);
    if ("error" in result) return json({ configured: true, error: result.error }, 503);
    return json(result);
  }
  return json({ error: "Unsupported Square action" }, 400);
}
