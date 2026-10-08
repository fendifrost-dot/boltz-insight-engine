-- Boltz Insight MCP agents and audit log.
-- Enrollment inserts a SHA-256 hex digest only. There is no secret column.
-- The service role (server routes) is the only database role that can touch these tables.
-- Browser roles have no grants and no policies. FORCE ROW LEVEL SECURITY keeps the
-- table owner inside RLS; service_role still bypasses it via BYPASSRLS.

CREATE TABLE IF NOT EXISTS public.mcp_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{0,63}$'),
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY['read', 'send', 'leads.write']::text[]
  ),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_agents_expiry_after_create CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.mcp_agents (id),
  tool text NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 80),
  args_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_code text NOT NULL CHECK (result_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_audit_args_redacted CHECK (
    NOT (
      args_summary ?| ARRAY['phone', 'email', 'text', 'body', 'name', 'notes', 'from', 'service']::text[]
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_agent_created
  ON public.mcp_audit_log (agent_id, created_at DESC);

COMMENT ON TABLE public.mcp_agents IS
  'MCP connector identities. secret_hash is lowercase hex SHA-256 of the bearer token. Never store the token.';
COMMENT ON COLUMN public.mcp_agents.secret_hash IS
  'Lowercase hex SHA-256 of the bearer token. The token itself is never stored.';
COMMENT ON TABLE public.mcp_audit_log IS
  'One row per authenticated MCP call, written before the tool runs. args_summary must not hold message bodies or phone numbers.';

ALTER TABLE public.mcp_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mcp_agents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mcp_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mcp_agents TO service_role;
GRANT ALL ON TABLE public.mcp_audit_log TO service_role;
