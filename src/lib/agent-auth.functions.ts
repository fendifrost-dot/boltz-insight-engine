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

/** Restore after Chrome quit. Reads the HttpOnly remember cookie on the server. */
export const restorePersistentShopSession = createServerFn({ method: "GET" }).handler(async () => {
  const { restorePersistentShopSessionFromRequest } = await import(
    "@/server/authz/remember-cookie.server"
  );
  return restorePersistentShopSessionFromRequest();
});

export const persistRememberToken = createServerFn({ method: "POST" })
  .inputValidator((input: { refresh_token?: string } | undefined) => ({
    refresh_token: typeof input?.refresh_token === "string" ? input.refresh_token.trim() : "",
  }))
  .handler(async ({ data }) => {
    if (!data.refresh_token) return { ok: false as const };
    const { writeHttpOnlyRememberCookie } = await import("@/server/authz/remember-cookie.server");
    writeHttpOnlyRememberCookie(data.refresh_token);
    return { ok: true as const };
  });

export const clearRememberToken = createServerFn({ method: "POST" }).handler(async () => {
  const { clearHttpOnlyRememberCookie } = await import("@/server/authz/remember-cookie.server");
  clearHttpOnlyRememberCookie();
  return { ok: true as const };
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
