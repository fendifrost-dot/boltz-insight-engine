import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkCapability } from "@/server/authz/require-capability.server";

export const getAgentAuthStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { resolveAgentAuthCredentials } = await import("@/server/authz/agent-login.server");
  return { configured: Boolean(await resolveAgentAuthCredentials()) };
});

export const signInShopAgent = createServerFn({ method: "POST" }).handler(async () => {
  const { signInWithStoredAgentCredentials } = await import("@/server/authz/agent-login.server");
  return signInWithStoredAgentCredentials();
});

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [isOwner, canSendSms] = await Promise.all([
      checkCapability(context, "integrations.manage"),
      checkCapability(context, "communications.send"),
    ]);
    return { isOwner, canSendSms };
  });
