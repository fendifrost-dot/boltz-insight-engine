import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/server/authz/require-capability.server";

/**
 * Google Ads server functions.
 * - Reads: owner-only (integrations.manage), live via the Google Ads API.
 * - Writes: owner-only, require explicit confirmation, and are blocked by the
 *   Boltz change-control freeze until 2026-08-29 10:00 America/Chicago.
 *   Dry runs (validateOnly) are always allowed so changes can be staged.
 */

export const getAdsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "integrations.manage");
    const { adsSecretStatus, adsConfigError } = await import("@/server/google-ads/env.server");
    const { adsWriteFreezeActive, ADS_WRITE_FREEZE_UNTIL, adsSearch } = await import(
      "@/server/google-ads/client.server"
    );

    const secrets = adsSecretStatus();
    const configError = adsConfigError();

    let reachable = false;
    let accountName: string | null = null;
    let detail: string | null = configError;

    if (!configError) {
      try {
        const rows = await adsSearch<{
          customer?: { descriptiveName?: string; currencyCode?: string };
        }>("SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1");
        reachable = true;
        accountName = rows[0]?.customer?.descriptiveName ?? null;
      } catch (error) {
        detail = error instanceof Error ? error.message : "Unknown Google Ads error";
      }
    }

    return {
      secrets,
      configError,
      reachable,
      accountName,
      detail,
      writeFreezeActive: adsWriteFreezeActive(),
      writeFreezeUntil: new Date(ADS_WRITE_FREEZE_UNTIL).toISOString(),
    };
  });

const RangeInput = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

export const getAdsPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RangeInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "integrations.manage");
    const { adsSearch, micros } = await import("@/server/google-ads/client.server");
    const days = data.days ?? 30;
    const during = `segments.date DURING LAST_${days === 7 ? "7" : days === 14 ? "14" : "30"}_DAYS`;

    try {
      const [campaigns, terms] = await Promise.all([
        adsSearch<Record<string, any>>(
          `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
                  metrics.average_cpc
           FROM campaign
           WHERE ${during}
           ORDER BY metrics.cost_micros DESC
           LIMIT 100`,
        ),
        adsSearch<Record<string, any>>(
          `SELECT search_term_view.search_term, campaign.name, metrics.impressions, metrics.clicks,
                  metrics.cost_micros, metrics.conversions
           FROM search_term_view
           WHERE ${during}
           ORDER BY metrics.cost_micros DESC
           LIMIT 200`,
        ),
      ]);

      return {
        ok: true as const,
        days,
        error: null as string | null,
        campaigns: campaigns.map((r) => ({
          id: String(r["campaign"]?.id ?? ""),
          name: String(r["campaign"]?.name ?? ""),
          status: String(r["campaign"]?.status ?? ""),
          channel: String(r["campaign"]?.advertisingChannelType ?? ""),
          impressions: Number(r["metrics"]?.impressions ?? 0),
          clicks: Number(r["metrics"]?.clicks ?? 0),
          cost: micros(r["metrics"]?.costMicros),
          conversions: Number(r["metrics"]?.conversions ?? 0),
          avgCpc: micros(r["metrics"]?.averageCpc),
        })),
        searchTerms: terms.map((r) => ({
          term: String(r["searchTermView"]?.searchTerm ?? ""),
          campaign: String(r["campaign"]?.name ?? ""),
          impressions: Number(r["metrics"]?.impressions ?? 0),
          clicks: Number(r["metrics"]?.clicks ?? 0),
          cost: micros(r["metrics"]?.costMicros),
          conversions: Number(r["metrics"]?.conversions ?? 0),
        })),
      };
    } catch (error) {
      console.error("getAdsPerformance failed", error);
      return {
        ok: false as const,
        days,
        error: error instanceof Error ? error.message : "Unknown Google Ads error",
        campaigns: [],
        searchTerms: [],
      };
    }
  });

const CampaignStatusInput = z.object({
  campaignId: z.string().regex(/^[0-9]+$/),
  status: z.enum(["ENABLED", "PAUSED"]),
  confirm: z.boolean(),
  dryRun: z.boolean().optional(),
  reason: z.string().min(4).max(400),
});

/** Owner-only write. Freeze-gated inside adsMutate; dry runs always permitted. */
export const setAdsCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CampaignStatusInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "integrations.manage");
    const { adsMutate, adsCustomerId } = await import("@/server/google-ads/client.server");

    const operations = [
      {
        update: {
          resourceName: `customers/${adsCustomerId()}/campaigns/${data.campaignId}`,
          status: data.status,
        },
        updateMask: "status",
      },
    ];

    const result = await adsMutate("campaigns", operations, {
      confirmed: data.confirm,
      dryRun: data.dryRun ?? true,
    } as never);

    return {
      ok: result.ok,
      reason: result.reason ?? null,
      dryRun: data.dryRun ?? true,
      campaignId: data.campaignId,
      status: data.status,
      auditReason: data.reason,
    };
  });
