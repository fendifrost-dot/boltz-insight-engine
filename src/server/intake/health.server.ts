// Records one integration_health_snapshots row per lead source.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { adsConfigError } from "@/server/google-ads/env.server";
import { recordHealth } from "@/server/lead-inbox/store.server";
import { FRESHNESS_SOURCES, freshnessVerdict } from "./freshness";
import { gmailConfigError } from "./gmail.server";

const GMAIL_PROVIDERS = new Set(["yelp", "durable", "google_lsa", "google_gbp"]);

export async function recordIntakeHealth(now = new Date()): Promise<{
  checks: { provider: string; checkName: string; ok: boolean; detail: string }[];
}> {
  const checks: { provider: string; checkName: string; ok: boolean; detail: string }[] = [];
  const gmailError = gmailConfigError();
  const adsError = adsConfigError();

  for (const source of FRESHNESS_SOURCES) {
    if (GMAIL_PROVIDERS.has(source.provider)) {
      const detail = gmailError ?? `${source.label}: Gmail intake configured`;
      const row = { provider: source.provider, checkName: "config", ok: !gmailError, detail };
      checks.push(row);
      await recordHealth({ provider: row.provider, checkName: row.checkName, ok: row.ok, detail: row.detail });
    }
    if (source.provider === "google_ads") {
      const detail = adsError ?? "Google Ads lead-form poll configured";
      const row = { provider: source.provider, checkName: "config", ok: !adsError, detail };
      checks.push(row);
      await recordHealth({ provider: row.provider, checkName: row.checkName, ok: row.ok, detail: row.detail });
    }

    let lastLeadAt: string | null = null;
    for (const leadSource of source.leadSources) {
      const { data, error } = await supabaseAdmin
        .from("leads")
        .select("created_at")
        .eq("lead_source", leadSource)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.created_at) continue;
      if (!lastLeadAt || data.created_at > lastLeadAt) lastLeadAt = data.created_at;
    }
    const verdict = freshnessVerdict({
      now,
      lastLeadAt,
      quietHours: source.quietHours,
      label: source.label,
    });
    checks.push({
      provider: source.provider,
      checkName: "lead_freshness",
      ok: verdict.ok,
      detail: verdict.detail,
    });
    await recordHealth({
      provider: source.provider,
      checkName: "lead_freshness",
      ok: verdict.ok,
      detail: verdict.detail,
    });
  }

  return { checks };
}
