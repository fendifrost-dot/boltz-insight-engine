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

async function latest(checkName: string, ok?: boolean): Promise<Snapshot | null> {
  let query = supabaseAdmin
    .from("integration_health_snapshots")
    .select("ok, detail, created_at, metadata_redacted")
    .eq("provider", META_PROVIDER)
    .eq("check_name", checkName);
  if (ok !== undefined) query = query.eq("ok", ok);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as Snapshot | null) ?? null;
}

async function countSubmissions(filter?: {
  column: "ingest_status" | "ingestion_method";
  values: string[];
}): Promise<number> {
  let query = supabaseAdmin
    .from("meta_lead_submissions")
    .select("id", { count: "exact", head: true });
  if (filter) query = query.in(filter.column, filter.values as never);
  const { count } = await query;
  return count ?? 0;
}

export async function getMetaHealth() {
  const configError = metaConfigError();
  const base = (readSecret("PUBLIC_APP_URL") ?? "").replace(/\/+$/, "");

  const [
    lastWebhook,
    lastSignatureFailure,
    lastGraphOk,
    lastGraphFail,
    lastIncremental,
    lastNightly,
    lastTokenFailure,
    lastLeadRes,
    recentRes,
    total,
    notIngested,
    failed,
    viaWebhook,
    viaReconciliation,
    viaManual,
  ] = await Promise.all([
    latest("webhook_received", true),
    latest("webhook_signature_invalid"),
    latest("graph_fetch", true),
    latest("graph_fetch", false),
    latest("reconcile_incremental"),
    latest("reconcile_nightly"),
    latest("token_auth", false),
    supabaseAdmin
      .from("meta_lead_submissions")
      .select(
        "meta_lead_id, platform, ingestion_method, ingest_status, created_time, ingested_at, lead_id, form_name",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("meta_lead_submissions")
      .select(
        "id, meta_lead_id, platform, ingestion_method, ingest_status, form_name, campaign_name, created_time, ingested_at, attempts, last_error, lead_id",
      )
      .order("created_at", { ascending: false })
      .limit(15),
    countSubmissions(),
    countSubmissions({ column: "ingest_status", values: ["received", "failed"] }),
    countSubmissions({ column: "ingest_status", values: ["failed"] }),
    countSubmissions({ column: "ingestion_method", values: ["WEBHOOK"] }),
    countSubmissions({ column: "ingestion_method", values: ["RECONCILIATION"] }),
    countSubmissions({ column: "ingestion_method", values: ["MANUAL_IMPORT"] }),
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
    const [subResult, tokenResult] = await Promise.allSettled([
      getPageSubscription(pageId, appId),
      debugPageToken(),
    ]);

    if (subResult.status === "fulfilled") {
      const sub = subResult.value;
      subscription = {
        status: sub.subscribed ? "subscribed" : "not_subscribed",
        fields: sub.fields,
        detail: sub.subscribed
          ? "App is subscribed to this Page's leadgen field"
          : sub.appFound
            ? "App is installed on the Page but leadgen is not a subscribed field"
            : "App is not subscribed to this Page",
      };
    } else {
      subscription.detail = String(
        subResult.reason instanceof Error ? subResult.reason.message : subResult.reason,
      );
    }

    if (tokenResult.status === "fulfilled") {
      const t = tokenResult.value;
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
    } else {
      token.status = "invalid";
      token.detail = String(
        tokenResult.reason instanceof Error ? tokenResult.reason.message : tokenResult.reason,
      );
    }

    await recordHealth({
      provider: META_PROVIDER,
      checkName: "page_subscription",
      ok: subscription.status === "subscribed",
      detail: subscription.detail,
    });
    await recordHealth({
      provider: META_PROVIDER,
      checkName: "token_debug",
      ok: token.status === "valid" && token.missingScopes.length === 0,
      detail: token.detail,
    });
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
    lastLead: lastLeadRes.data ?? null,
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
    recent: recentRes.data ?? [],
  };
}
