/** Pure rules for Grok / shop-agent silent re-login. Never reads secrets. */

export function shouldAutoLoginShopAgent(input: {
  persistEnabled: boolean;
  hasSession: boolean;
  secretsConfigured: boolean;
  manualSignOut: boolean;
}): boolean {
  return (
    input.persistEnabled && input.secretsConfigured && !input.hasSession && !input.manualSignOut
  );
}
