import {
  checkCapabilityWithProbe,
  type Capability,
  type RoleProbe,
} from "./capabilities.ts";

type RpcResult = { data: unknown; error: { message: string } | null };

export type CapabilityAuthContext = {
  // Structurally compatible with both the generated Supabase client and test doubles.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { rpc: (...args: any[]) => any };
  userId: string;
};

async function callRpc(
  context: CapabilityAuthContext,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  return (await context.supabase.rpc(fn, args)) as RpcResult;
}

function roleProbe(context: CapabilityAuthContext): RoleProbe {
  return {
    isStaff: async () => {
      const { data, error } = await callRpc(context, "is_staff", { _user_id: context.userId });
      return !error && data === true;
    },
    isOwner: async () => {
      const { data, error } = await callRpc(context, "has_role", {
        _user_id: context.userId,
        _role: "owner",
      });
      return !error && data === true;
    },
  };
}

/** Returns whether the authenticated user may perform the capability. */
export async function checkCapability(
  context: CapabilityAuthContext,
  capability: Capability,
): Promise<boolean> {
  return checkCapabilityWithProbe(roleProbe(context), capability);
}

/** Throws when the user lacks the required capability. Call before any service-role work. */
export async function requireCapability(
  context: CapabilityAuthContext,
  capability: Capability,
): Promise<void> {
  const allowed = await checkCapability(context, capability);
  if (!allowed) {
    throw new Error(`Missing capability: ${capability}`);
  }
}

/** @deprecated Prefer requireCapability("integrations.manage") for new code. */
export async function requireOwner(context: CapabilityAuthContext): Promise<void> {
  await requireCapability(context, "integrations.manage");
}
