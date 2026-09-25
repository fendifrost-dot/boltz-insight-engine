// Meta section of /integration-health. Callers must already hold integrations.manage.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readSecret } from "@/server/lead-inbox/env.server";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { metaConfigError, metaSecretStatus, readMetaSecret } from "./env.server";
import { REQUIRED_SCOPES, debugPageToken, getPageSubscription } from "./graph.server";
import { META_PROVIDER } from "./ingest.server";

type Snapshot = {
  ok: boolean;
  detail: string | null;
  created_at: string;
  metadata_redacted: unknown;
};

export type MetaHealthCheckError = { check: string; message: string };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 400);
  if (error && typeof error === "object") {
    // PostgREST errors: message/code/details/hint, any of which may be empty.
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.message, e.code ? `code ${String(e.code)}` : null, e.details, e.hint]
      .filter((p) => p !== null && p !== undefined && String(p).trim() !== "")
      .map(String);
    return (parts.join(" · ") || "query failed with no error detail").slice(0, 400);
  }
  return String(error).slice(0, 400);
}

/**
 * Runs one health check in isolation. A failing check records its real error
 * and falls back, so one bad query or Graph call never blanks the whole panel.
 */
async function settle<T>(
  errors: MetaHealthCheckError[],
  check: string,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = describe(error);
    console.error(`[meta health] ${check}: ${message}`);
    errors.push({ check, message });
    return fallback;
  }
}

async function latest(checkName: string, ok?: boolean): Promise<Snapshot | null> {
  let query = supabaseAdmin
    .from("integration_health_snapshots")
    .select("ok, detail, created_at, metadata_redacted")
    .eq("provider", META_PROVIDER)
    .eq("check_name", checkName);
  if (ok !== undefined) query = query.eq("ok", ok);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Snapshot | null) ?? null;
}

async function countSubmissions(filter?: {
  column: "ingest_status" | "ingestion_method";
  values: string[];
}): Promise<number> {
  let query = supabaseAdmin
    .from("meta_lead_submissions")
    // Not head:true — a HEAD request carries no error body, so failures would be blank.
    .select("id", { count: "exact" })
    .limit(1);
  if (filter) query = query.in(filter.column, filter.values as never);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

type LastLead = {
  meta_lead_id: string;
  platform: string | null;
  ingestion_method: string;
  ingest_status: string;
  created_time: string | null;
  ingested_at: string | null;
  lead_id: string | null;
  form_name: string | null;
};

type RecentRow = LastLead & {
  id: string;
  campaign_name: string | null;
  attempts: number;
  last_error: string | null;
};

export async function getMetaHealth() {
  const errors: MetaHealthCheckError[] = [];
  const configError = metaConfigError();
  const base = (readSecret("PUBLIC_APP_URL") ?? "").replace(/\/+$/, "");
  const snap = (check: string, name: string, ok?: boolean) =>
    settle(errors, check, null, () => latest(name, ok));
  const count = (check: string, filter?: Parameters<typeof countSubmissions>[0]) =>
    settle(errors, check, 0, () => countSubmissions(filter));

  const [
    lastWebhook,
    lastSignatureFailure,
    lastGraphOk,
    lastGraphFail,
    lastIncremental,
    lastNightly,
    lastTokenFailure,
    lastLead,
    recent,
    total,
    notIngested,
    failed,
    viaWebhook,
    viaReconciliation,
    viaManual,
  ] = await Promise.all([
    snap("last webhook", "webhook_received", true),
    snap("last signature failure", "webhook_signature_invalid"),
    snap("last Graph success", "graph_fetch", true),
    snap("last Graph failure", "graph_fetch", false),
    snap("last incremental reconciliation", "reconcile_incremental"),
    snap("last nightly reconciliation", "reconcile_nightly"),
    snap("last token failure", "token_auth", false),
    settle<LastLead | null>(errors, "last Meta lead", null, async () => {
      const { data, error } = await supabaseAdmin
        .from("meta_lead_submissions")
        .select(
          "meta_lead_id, platform, ingestion_method, ingest_status, created_time, ingested_at, lead_id, form_name",
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }),
    settle<RecentRow[]>(errors, "recent submissions", [], async () => {
      const { data, error } = await supabaseAdmin
        .from("meta_lead_submissions")
        .select(
          "id, meta_lead_id, platform, ingestion_method, ingest_status, form_name, campaign_name, created_time, ingested_at, attempts, last_error, lead_id",
        )
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    }),
    count("submission count"),
    count("not-ingested count", { column: "ingest_status", values: ["received", "failed"] }),
    count("failed count", { column: "ingest_status", values: ["failed"] }),
    count("webhook count", { column: "ingestion_method", values: ["WEBHOOK"] }),
    count("reconciliation count", { column: "ingestion_method", values: ["RECONCILIATION"] }),
    count("manual import count", { column: "ingestion_method", values: ["MANUAL_IMPORT"] }),
  ]);

  let subscription: {
    status: "subscribed" | "not_subscribed" | "unknown";
    fields: string[];
    detail: string;
  } = {
    status: "unknown",
    fields: [],
    detail: configError ?? "not checked",
  };
  let token: {
    status: "valid" | "invalid" | "unknown";
    type: string | null;
    expiresAt: string | null;
    missingScopes: string[];
    detail: string;
  } = {
    status: "unknown",
    type: null,
    expiresAt: null,
    missingScopes: [],
    detail: configError ?? "not checked",
  };

  if (!configError) {
    const pageId = readMetaSecret("META_PAGE_ID") as string;
    const appId = readMetaSecret("META_APP_ID") as string;

    const fail = (check: string, error: unknown): string => {
      const message = describe(error);
      console.error(`[meta health] ${check}: ${message}`);
      errors.push({ check, message });
      return message;
    };

    await Promise.all([
      (async () => {
        try {
          const sub = await getPageSubscription(pageId, appId);
          subscription = {
            status: sub.subscribed ? "subscribed" : "not_subscribed",
            fields: sub.fields,
            detail: sub.subscribed
              ? "App is subscribed to this Page's leadgen field"
              : sub.appFound
                ? "App is installed on the Page but leadgen is not a subscribed field"
                : "App is not subscribed to this Page",
          };
        } catch (error) {
          subscription.detail = fail("Page subscription", error);
        }
      })(),
      (async () => {
        try {
          const t = await debugPageToken();
          const missingScopes = REQUIRED_SCOPES.filter((s) => !t.scopes.includes(s));
          token = {
            status: t.isValid ? "valid" : "invalid",
            type: t.type,
            expiresAt: t.expiresAt,
            missingScopes,
            detail:
              t.error ??
              (missingScopes.length > 0
                ? `Missing scopes: ${missingScopes.join(", ")}`
                : "Token valid"),
          };
        } catch (error) {
          token.status = "invalid";
          token.detail = fail("token health", error);
        }
      })(),
    ]);

    await settle(errors, "record Page subscription snapshot", undefined, () =>
      recordHealth({
        provider: META_PROVIDER,
        checkName: "page_subscription",
        ok: subscription.status === "subscribed",
        detail: subscription.detail,
      }),
    );
    await settle(errors, "record token snapshot", undefined, () =>
      recordHealth({
        provider: META_PROVIDER,
        checkName: "token_debug",
        ok: token.status === "valid" && token.missingScopes.length === 0,
        detail: token.detail,
      }),
    );
  }

  const lastReconcile =
    [lastIncremental, lastNightly]
      .filter((s): s is Snapshot => Boolean(s))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const reconcileMeta = (lastReconcile?.metadata_redacted ?? {}) as {
    missingDetected?: number;
    notIngested?: number;
  };

  return {
    checkedAt: new Date().toISOString(),
    errors,
    configError,
    secrets: metaSecretStatus(),
    webhook: {
      configured: Boolean(
        readMetaSecret("META_APP_SECRET") && readMetaSecret("META_WEBHOOK_VERIFY_TOKEN"),
      ),
      callbackUrl: base ? `${base}/api/public/meta/webhook` : null,
      lastWebhookAt: lastWebhook?.created_at ?? null,
      lastSignatureFailureAt: lastSignatureFailure?.created_at ?? null,
    },
    subscription,
    token: {
      ...token,
      lastAuthFailureAt: lastTokenFailure?.created_at ?? null,
      lastAuthFailureDetail: lastTokenFailure?.detail ?? null,
    },
    graph: {
      lastSuccessAt: lastGraphOk?.created_at ?? null,
      lastFailureAt: lastGraphFail?.created_at ?? null,
      lastFailureDetail: lastGraphFail?.detail ?? null,
    },
    reconciliation: {
      lastIncremental: lastIncremental
        ? { at: lastIncremental.created_at, ok: lastIncremental.ok, detail: lastIncremental.detail }
        : null,
      lastNightly: lastNightly
        ? { at: lastNightly.created_at, ok: lastNightly.ok, detail: lastNightly.detail }
        : null,
      missingAtLastRun: (reconcileMeta.missingDetected ?? 0) + (reconcileMeta.notIngested ?? 0),
    },
    lastLead,
    counts: {
      total,
      notIngested,
      failed,
      byMethod: {
        WEBHOOK: viaWebhook,
        RECONCILIATION: viaReconciliation,
        MANUAL_IMPORT: viaManual,
      },
    },
    recent,
  };
}
