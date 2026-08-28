import {
  buildLifecycleEvidenceMetadata,
  resolveTransitionActorKind,
  validateLifecycleTransition,
  type Lifecycle,
  type LifecycleEvidence,
} from "@/lib/lifecycle-transitions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addEvent } from "./store.server";

export type ApplyLifecycleTransitionResult =
  | { ok: true; applied: false; reason: "unchanged" }
  | { ok: true; applied: true; from: Lifecycle; to: Lifecycle }
  | { ok: false; reason: string };

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
    return { ok: false, reason: `Unsupported lifecycle transition actor: ${args.actor}` };
  }

  const validation = validateLifecycleTransition({
    from: args.fromLifecycle,
    to: args.toLifecycle,
    actor: actorKind,
    evidence: args.evidence,
  });
  if (!validation.ok) {
    return validation;
  }

  const evidenceMetadata = buildLifecycleEvidenceMetadata(args.evidence, args.nowIso);
  const { error } = await supabaseAdmin
    .from("leads")
    .update({ lifecycle: args.toLifecycle })
    .eq("id", args.leadId)
    .eq("lifecycle", args.fromLifecycle);
  if (error) {
    return { ok: false, reason: error.message };
  }

  await addEvent(
    args.leadId,
    "lifecycle_changed",
    args.summary ?? `Lifecycle moved to ${args.toLifecycle}`,
    args.actor,
    {
      ...evidenceMetadata,
      proposed_to: args.toLifecycle,
    },
    { from: args.fromLifecycle, to: args.toLifecycle },
  );

  return { ok: true, applied: true, from: args.fromLifecycle, to: args.toLifecycle };
}
