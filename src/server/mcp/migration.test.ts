import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = readFileSync(join(root, "supabase/migrations/20261008170000_mcp_agents.sql"), "utf8");

test("MCP tables store a hash, lock out browser roles, and redact audit args", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mcp_agents/);
  assert.match(sql, /secret_hash text NOT NULL UNIQUE/);
  assert.match(sql, /secret_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(sql, /\bsecret\s+text\b/i);
  assert.doesNotMatch(sql, /insert into public\.mcp_agents/i);
  assert.match(sql, /'read', 'send', 'leads\.write'/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mcp_audit_log/);
  assert.match(sql, /args_summary jsonb NOT NULL/);
  assert.match(sql, /mcp_audit_args_redacted/);
  assert.match(sql, /'phone', 'email', 'text', 'body', 'name', 'notes', 'from', 'service'/);

  assert.match(sql, /ALTER TABLE public\.mcp_agents ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.mcp_audit_log ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.mcp_agents FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.mcp_audit_log FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.mcp_agents FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.mcp_audit_log FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.mcp_agents TO service_role/);
  assert.match(sql, /GRANT ALL ON TABLE public\.mcp_audit_log TO service_role/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /to authenticated/i);
});
