# Roadmap

- [x] Vault fallback for stored-agent credentials (env → vault, cached) + async availability check
- [x] Silent restore now also fires from session recovery when no session exists
- [x] Agent account: already existed (confirmed, staff-only) — not recreated
- [x] Vault credentials verified working via end-to-end silent auto-login on /auth
- [x] Integration Health AGENT_AUTH_* presence now vault-aware (no false "Missing")
- [ ] Republish so the fix reaches the live app
