// Service-role access to MCP credential and audit tables. The key stays in this process.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AuditWrite, McpAgent, McpStore } from "./protocol.ts";

type Row = Record<string, unknown>;

interface Builder extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select(columns: string): Builder;
  eq(column: string, value: string): Builder;
  insert(values: Record<string, unknown>): Builder;
  update(values: Record<string, unknown>): Builder;
  maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }>;
  single(): Promise<{ data: Row | null; error: { message: string } | null }>;
}

function from(table: "mcp_agents" | "mcp_audit_log"): Builder {
  return (supabaseAdmin as unknown as { from: (table: string) => Builder }).from(table);
}

function asAgent(row: Row): McpAgent {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    secretHash: String(row["secret_hash"]),
    scopes: Array.isArray(row["scopes"]) ? row["scopes"].map(String) : [],
    revokedAt: row["revoked_at"] == null ? null : String(row["revoked_at"]),
    expiresAt: row["expires_at"] == null ? null : String(row["expires_at"]),
  };
}

export function createSupabaseMcpStore(): McpStore {
  return {
    async findAgentByHash(secretHash) {
      const { data, error } = await from("mcp_agents")
        .select("id, name, secret_hash, scopes, expires_at, revoked_at")
        .eq("secret_hash", secretHash)
        .maybeSingle();
      if (error) throw new Error("agent lookup failed");
      if (!data) return null;
      return asAgent(data);
    },

    async insertAudit(row: AuditWrite) {
      const { data, error } = await from("mcp_audit_log")
        .insert({
          agent_id: row.agentId,
          tool: row.tool,
          args_summary: row.argsSummary,
          result_code: row.resultCode,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error(
          "[mcp] audit insert",
          (error?.message ?? "failed").replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200),
        );
        return { error: "audit insert failed" };
      }
      return { id: String(data["id"]) };
    },

    async finishAudit(id, resultCode) {
      const { error } = await from("mcp_audit_log")
        .update({ result_code: resultCode })
        .eq("id", id);
      if (error) throw new Error("audit finish failed");
    },
  };
}
