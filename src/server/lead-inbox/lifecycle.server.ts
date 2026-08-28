import {
  buildLifecycleEvidenceMetadata,
  resolveTransitionActorKind,
  validateLifecycleTransition,
  type Lifecycle,
  type LifecycleEvidence,
} from "@/lib/lifecycle-transitions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
  const { data, error } = await supabaseAdmin.rpc("apply_lead_lifecycle_transition", {
    _lead_id: args.leadId,
    _expected_from: args.fromLifecycle,
    _to: args.toLifecycle,
    _event_type: "lifecycle_changed",
    _summary: args.summary ?? `Lifecycle moved to ${args.toLifecycle}`,
    _actor: args.actor,
    _metadata: {
      ...evidenceMetadata,
      proposed_to: args.toLifecycle,
    } as never,
  });

  if (error) {
    return { ok: false, reason: error.message, code: "rpc_error" };
  }

  const payload = data as RpcTransitionPayload | null;
  if (!payload || typeof payload !== "object" || !("status" in payload)) {
    return { ok: false, reason: "Lifecycle transition RPC returned an invalid payload", code: "rpc_error" };
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

  return { ok: false, reason: "Lifecycle transition RPC returned an unknown status", code: "rpc_error" };
}
