/**
 * Integration health checks — redacted details only.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getAuthenticatedExtension,
  resolveFromNumberCapability,
} from "@/integrations/ringcentral/client.server";
import { RingCentralSetupError } from "@/integrations/ringcentral/types";
import {
  getPublicAppUrl,
  getRingCentralConfigStatus,
  getXaiConfigStatus,
  maskPhone,
} from "@/lib/server/env.server";

export async function getIntegrationHealth() {
  const rcStatus = getRingCentralConfigStatus();
  const xaiStatus = getXaiConfigStatus();

  let rcConnection: "ok" | "error" | "missing_config" = rcStatus.configured
    ? "ok"
    : "missing_config";
  let rcError: string | null = null;
  let extensionId: string | null = null;
  let smsCapability: string | null = null;
  let fromNumberMasked = rcStatus.fromNumberMasked;

  if (rcStatus.configured) {
    try {
      const ext = await getAuthenticatedExtension();
      extensionId = ext.id;
      const resolved = await resolveFromNumberCapability();
      smsCapability = resolved.capability;
      fromNumberMasked = maskPhone(resolved.phone.phoneNumber);
      rcConnection = "ok";
    } catch (err) {
      rcConnection = "error";
      rcError =
        err instanceof RingCentralSetupError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "RingCentral health check failed";
    }
  }

  const { data: subs } = await supabaseAdmin
    .from("ringcentral_subscriptions")
    .select(
      "provider_subscription_id, status, expires_at, last_notification_at, last_renewal_error, delivery_address",
    )
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: lastInbound } = await supabaseAdmin
    .from("messages")
    .select("created_at, delivery_state")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recentErrors } = await supabaseAdmin
    .from("message_jobs")
    .select("id, job_type, status, last_error, updated_at")
    .not("last_error", "is", null)
    .order("updated_at", { ascending: false })
    .limit(10);

  const { count: escalationsOpen } = await supabaseAdmin
    .from("escalations")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  return {
    ringcentral: {
      secrets: rcStatus.configured ? "Configured" : "Missing",
      missing: rcStatus.missing,
      connection: rcConnection,
      error: rcError,
      serverUrl: rcStatus.serverUrl,
      fromNumberMasked,
      extensionId,
      smsCapability,
      webhookPath: "/api/ringcentral/webhook",
      publicAppUrl: getPublicAppUrl(),
      subscriptions: (subs ?? []).map((s) => ({
        id: s.provider_subscription_id,
        status: s.status,
        expiresAt: s.expires_at,
        lastNotificationAt: s.last_notification_at,
        lastRenewalError: s.last_renewal_error,
        deliveryAddressConfigured: Boolean(s.delivery_address),
      })),
      lastInboundAt: lastInbound?.created_at ?? null,
    },
    grok: {
      secrets: xaiStatus.configured ? "Configured" : "Missing",
      missing: xaiStatus.missing,
      model: xaiStatus.model,
    },
    jobs: {
      recentErrors: (recentErrors ?? []).map((j) => ({
        id: j.id,
        jobType: j.job_type,
        status: j.status,
        lastError: j.last_error,
        updatedAt: j.updated_at,
      })),
    },
    escalationsOpen: escalationsOpen ?? 0,
  };
}
