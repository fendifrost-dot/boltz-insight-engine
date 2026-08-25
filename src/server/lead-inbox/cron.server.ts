// Shared cron helpers: bearer auth + subscription renewal + reconciliation.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readSecret, safeEqual } from "./env.server";
import {
  EVENT_FILTERS,
  createWebhookSubscription,
  getSubscription,
  listRecentMessages,
  redact,
  renewSubscription,
} from "./ringcentral.server";
import { enqueueJob, recordHealth } from "./store.server";

export function authorizeCron(request: Request): Response | null {
  const secret = readSecret("CRON_SECRET");
  if (!secret) return new Response("Cron secret not configured", { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return new Response("Unauthorized", { status: 401 });
  return null;
}

function webhookAddress(): string {
  const base = (readSecret("PUBLIC_APP_URL") ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("PUBLIC_APP_URL is not configured");
  return `${base}/api/public/ringcentral/webhook`;
}

const RENEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function renewSubscriptions(): Promise<{
  checked: number;
  renewed: number;
  created: number;
  errors: string[];
}> {
  const result = { checked: 0, renewed: 0, created: 0, errors: [] as string[] };
  const address = webhookAddress();

  const { data: rows, error } = await supabaseAdmin
    .from("ringcentral_subscriptions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;

  const active = (rows ?? []).filter((r) => r.status === "Active" && r.delivery_address === address);
  result.checked = active.length;

  for (const row of active) {
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
    if (expiresAt && expiresAt - Date.now() > RENEW_WINDOW_MS) continue;
    try {
      const renewed = await renewSubscription(row.provider_subscription_id);
      await supabaseAdmin
        .from("ringcentral_subscriptions")
        .update({
          status: renewed.status,
          expires_at: renewed.expirationTime ?? null,
          last_renewed_at: new Date().toISOString(),
          last_renewal_error: null,
        })
        .eq("id", row.id);
      result.renewed += 1;
    } catch (err) {
      const detail = redact(err instanceof Error ? err.message : String(err));
      result.errors.push(detail);
      await supabaseAdmin
        .from("ringcentral_subscriptions")
        .update({ last_renewal_error: detail, status: "RenewFailed" })
        .eq("id", row.id);
    }
  }

  if (active.length === 0) {
    try {
      const created = await createWebhookSubscription(address);
      await supabaseAdmin.from("ringcentral_subscriptions").insert({
        provider_subscription_id: created.id,
        status: created.status,
        delivery_address: address,
        event_filters: created.eventFilters ?? EVENT_FILTERS,
        expires_at: created.expirationTime ?? null,
        from_number_e164: readSecret("RINGCENTRAL_FROM_NUMBER") ?? null,
      });
      result.created = 1;
    } catch (err) {
      result.errors.push(redact(err instanceof Error ? err.message : String(err)));
    }
  }

  await recordHealth({
    provider: "ringcentral",
    checkName: "subscription_renewal",
    ok: result.errors.length === 0,
    detail: result.errors[0] ?? `checked ${result.checked}, renewed ${result.renewed}, created ${result.created}`,
  });

  return result;
}

export async function verifySubscriptionStatus(): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from("ringcentral_subscriptions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);
  for (const row of rows ?? []) {
    try {
      const remote = await getSubscription(row.provider_subscription_id);
      await supabaseAdmin
        .from("ringcentral_subscriptions")
        .update({ status: remote.status, expires_at: remote.expirationTime ?? null })
        .eq("id", row.id);
    } catch {
      // status check failures are surfaced by the renewal health snapshot
    }
  }
}

/** Backstop for missed webhooks: bounded look-back, database-deduplicated. */
export async function reconcileMessages(lookbackMinutes = 180): Promise<{
  scanned: number;
  enqueued: number;
}> {
  const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
  const records = await listRecentMessages(sinceIso);
  let enqueued = 0;

  for (const record of records.slice(0, 100)) {
    if (record.direction !== "Inbound" || record.id == null) continue;
    const from = record.from?.phoneNumber;
    if (!from) continue;

    const { data: existing } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("provider_message_id", String(record.id))
      .maybeSingle();
    if (existing) continue;

    const job = await enqueueJob({
      jobType: "process_inbound",
      inboundProviderMessageId: String(record.id),
      payload: {
        provider_message_id: String(record.id),
        body: record.subject ?? "",
        from,
        to: (record.to ?? []).map((t) => t.phoneNumber).filter((p): p is string => Boolean(p)),
        provider_created_at: record.creationTime ?? null,
        channel: record.type === "MMS" ? "MMS" : "SMS",
      },
    });
    if (job) enqueued += 1;
  }

  await recordHealth({
    provider: "ringcentral",
    checkName: "reconcile_messages",
    ok: true,
    detail: `scanned ${records.length}, enqueued ${enqueued}`,
  });

  return { scanned: records.length, enqueued };
}
