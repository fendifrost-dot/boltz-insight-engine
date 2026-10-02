// Read-only Google Ads call pull. Uses adsSearch only — never adsMutate.
// Stores weekly aggregates and a call_reporting health row. Sends no messages.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { adsCustomerId, adsSearch } from "./client.server";
import {
  callConversionsQuery,
  callViewQuery,
  leadFormCountQuery,
  phoneCallsQuery,
  toCallReport,
  weeklySnapshot,
  type AdsCallReport,
  type CallWindow,
} from "./call-report";

function safeDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : "Google Ads query failed";
  return text.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 300);
}

async function searchOrError(
  query: string,
): Promise<{ rows: unknown[] | null; error: string | null }> {
  try {
    return { rows: await adsSearch<unknown>(query), error: null };
  } catch (error) {
    return { rows: null, error: safeDetail(error) };
  }
}

export async function pullAdsCallReport(window: CallWindow): Promise<AdsCallReport> {
  const [calls, leads, phone, conversions] = await Promise.all([
    searchOrError(callViewQuery(window)),
    searchOrError(leadFormCountQuery(window)),
    searchOrError(phoneCallsQuery(window)),
    searchOrError(callConversionsQuery(window)),
  ]);

  const report = toCallReport({
    window,
    customerId: adsCustomerId(),
    callRows: calls.rows,
    callError: calls.error,
    leadRows: leads.rows,
    leadError: leads.error,
    phoneRows: phone.rows,
    phoneError: phone.error,
    conversionRows: conversions.rows,
    conversionError: conversions.error,
    stored: false,
    generatedAt: new Date().toISOString(),
  });

  let stored = false;
  try {
    const row = weeklySnapshot(report);
    const { error } = await supabaseAdmin.from("ads_call_weekly").upsert(
      {
        ...row,
        calls_by_campaign: row.calls_by_campaign as Json | null,
        calls_by_day: row.calls_by_day as Json | null,
        metrics_by_campaign: row.metrics_by_campaign as Json | null,
      },
      { onConflict: "week_start,customer_id" },
    );
    stored = !error;
    if (error) console.error("[cron ads-calls] snapshot", safeDetail(new Error(error.message)));
  } catch (error) {
    console.error("[cron ads-calls] snapshot", safeDetail(error));
  }

  try {
    await recordHealth({
      provider: "google_ads",
      checkName: "call_reporting",
      ok: report.call_reporting_ok,
      detail: report.detail,
    });
  } catch (error) {
    console.error("[cron ads-calls] health", safeDetail(error));
  }

  return { ...report, stored };
}
