// Calls the lifecycle RPC as a method so the Supabase client stays bound.
// Detaching `.rpc` and calling it as a bare function drops `this` and throws
// before Postgres runs, which the MCP layer used to report as "request failed".

export type LifecycleRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function callApplyLeadLifecycleTransition(
  client: LifecycleRpcClient,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> {
  return client.rpc("apply_lead_lifecycle_transition", args);
}
