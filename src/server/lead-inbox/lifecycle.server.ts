import {
  buildLifecycleEvidenceMetadata,
  canonicalLifecycle,
  resolveTransitionActorKind,
  validateLifecycleTransition,
  type Lifecycle,
  type LifecycleEvidence,
} from "@/lib/lifecycle-transitions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callApplyLeadLifecycleTransition, type LifecycleRpcClient } from "./lifecycle-rpc";

type RpcTransitionPayload =
  | { status: "unchanged" }
  | { status: "applied"; from: string; to: string }
  | { status: "stale"; reason: string };

export type ApplyLifecycleTransitionResult =
  | { ok: true; applied: false; reason: "unchanged" }
  | { ok: true; applied: true; from: Lifecycle; to: Lifecycle }
  | {
      ok: false;
      reason: string;
      code: "stale" | "validation" | "unsupported_actor" | "rpc_error";
    };

export async function applyLifecycleTransition(args: {
  leadId: string;
  fromLifecycle: Lifecycle;
  toLifecycle: Lifecycle;
  actor: string;
  evidence: LifecycleEvidence;
  summary?: string;
  nowIso?: string;
}): Promise<ApplyLifecycleTransitionResult> {
  if (args.fromLifecycle === args.toLifecycle) {
    return { ok: true, applied: false, reason: "unchanged" };
  }

  const actorKind = resolveTransitionActorKind(args.actor);
  if (!actorKind) {
    return {
      ok: false,
      reason: `Unsupported lifecycle transition actor: ${args.actor}`,
      code: "unsupported_actor",
    };
  }

  const validation = validateLifecycleTransition({
    from: args.fromLifecycle,
    to: args.toLifecycle,
    actor: actorKind,
    evidence: args.evidence,
  });
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, code: "validation" };
  }

  const evidenceMetadata = buildLifecycleEvidenceMetadata(args.evidence, args.nowIso);
  // The generated Database types omit this function. Call it as a method on the
  // client. Copying supabaseAdmin.rpc into a local and calling that copy drops
  // `this` and throws before Postgres runs.
  let data: unknown;
  let error: { message: string } | null;
  try {
    const response = await callApplyLeadLifecycleTransition(
      supabaseAdmin as unknown as LifecycleRpcClient,
      {
        _lead_id: args.leadId,
        _expected_from: args.fromLifecycle,
        _to: args.toLifecycle,
        _event_type: "lifecycle_changed",
        _summary: args.summary ?? `Lifecycle moved to ${args.toLifecycle}`,
        _actor: args.actor,
        _metadata: {
          ...evidenceMetadata,
          proposed_to: args.toLifecycle,
        },
      },
    );
    data = response.data;
    error = response.error;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Lifecycle update failed";
    return { ok: false, reason: message, code: "rpc_error" };
  }

  if (error) {
    return { ok: false, reason: error.message, code: "rpc_error" };
  }

  const payload = data as RpcTransitionPayload | null;
  if (!payload || typeof payload !== "object" || !("status" in payload)) {
    return {
      ok: false,
      reason: "Lifecycle transition RPC returned an invalid payload",
      code: "rpc_error",
    };
  }

  if (payload.status === "unchanged") {
    return { ok: true, applied: false, reason: "unchanged" };
  }

  if (payload.status === "stale") {
    return {
      ok: false,
      reason: payload.reason ?? "Lead lifecycle changed before transition could apply",
      code: "stale",
    };
  }

  if (payload.status === "applied") {
    return { ok: true, applied: true, from: args.fromLifecycle, to: args.toLifecycle };
  }

  return {
    ok: false,
    reason: "Lifecycle transition RPC returned an unknown status",
    code: "rpc_error",
  };
}

/**
 * A successful bot text moves New to Contacted. Later stages, including Paid,
 * are left untouched. A missing message id does not invent the move.
 */
export async function markContactedAfterOutboundSms(args: {
  leadId: string;
  fromLifecycle: string;
  messageId: string | null;
}): Promise<{ lifecycle: string; warning?: string }> {
  const from = canonicalLifecycle(args.fromLifecycle);
  if (!from || from !== "New" || !args.messageId) {
    return { lifecycle: args.fromLifecycle };
  }
  try {
    const result = await applyLifecycleTransition({
      leadId: args.leadId,
      fromLifecycle: "New",
      toLifecycle: "Contacted",
      actor: "system",
      evidence: { basis: "outbound_sms", evidenceRef: args.messageId },
      summary: "Outbound SMS sent; lifecycle moved from New to Contacted",
    });
    if (!result.ok) {
      return { lifecycle: "New", warning: `Lead stayed New: ${result.reason}` };
    }
    if (result.applied) return { lifecycle: "Contacted" };
    return { lifecycle: "New" };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "lifecycle update failed";
    return { lifecycle: "New", warning: `Lead stayed New: ${message}` };
  }
}
