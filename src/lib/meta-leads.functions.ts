import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/server/authz/require-capability.server";

/**
 * Server-fn authorization audit (Meta Lead Ads):
 * - getMetaHealthFn, reconcileMetaNow, importMetaLead, subscribeMetaPage:
 *   provider tokens / integration state → integrations.manage (owner), checked
 *   before any secret read or Graph call.
 * None of these send messages; outbound stays on communications.send.
 */

export const getMetaHealthFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "integrations.manage");
    const { getMetaHealth } = await import("@/server/meta-leads/health.server");
    return getMetaHealth();
  });

export const reconcileMetaNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ window: z.enum(["incremental", "nightly"]).default("incremental") })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "integrations.manage");
    const { reconcileMetaLeads } = await import("@/server/meta-leads/reconcile.server");
    try {
      const summary = await reconcileMetaLeads({ window: data.window });
      return { ok: true as const, summary, error: null };
    } catch (error) {
      return {
        ok: false as const,
        summary: null,
        error: error instanceof Error ? error.message.slice(0, 400) : "reconciliation failed",
      };
    }
  });

export const importMetaLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadgenId: z
          .string()
          .trim()
          .regex(/^\d{5,32}$/, "Meta lead IDs are numeric"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "integrations.manage");
    const { metaConfigError } = await import("@/server/meta-leads/env.server");
    const configError = metaConfigError();
    if (configError) return { ok: false as const, error: configError, outcome: null };
    const { ingestMetaLead } = await import("@/server/meta-leads/ingest.server");
    const outcome = await ingestMetaLead({ metaLeadId: data.leadgenId, method: "MANUAL_IMPORT" });
    return outcome.status === "failed"
      ? { ok: false as const, error: outcome.error, outcome }
      : { ok: true as const, error: null, outcome };
  });

export const subscribeMetaPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCapability(context, "integrations.manage");
    const { metaConfigError, requireMetaSecret } = await import("@/server/meta-leads/env.server");
    const configError = metaConfigError();
    if (configError) return { ok: false as const, error: configError };
    const { subscribePageLeadgen } = await import("@/server/meta-leads/graph.server");
    const { recordHealth } = await import("@/server/lead-inbox/store.server");
    try {
      const success = await subscribePageLeadgen(requireMetaSecret("META_PAGE_ID"));
      await recordHealth({
        provider: "meta",
        checkName: "page_subscription",
        ok: success,
        detail: success
          ? "Subscribed app to Page leadgen"
          : "Meta did not confirm the subscription",
      });
      return success
        ? { ok: true as const, error: null }
        : { ok: false as const, error: "Meta did not confirm the subscription" };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message.slice(0, 400) : "subscribe failed",
      };
    }
  });
