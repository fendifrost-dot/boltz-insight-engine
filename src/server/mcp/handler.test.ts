import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleMcpRequest, type McpDeps } from "./handler.ts";
import { sha256Hex, type AuditWrite, type McpAgent, type McpToolRunner } from "./protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = "mcp-test-token-value-01";
const HASH = sha256Hex(TOKEN);

function agent(overrides: Partial<McpAgent> = {}): McpAgent {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    name: "lead-follow-up",
    secretHash: HASH,
    scopes: ["read"],
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function harness(agents: McpAgent[], runner?: McpToolRunner["run"]) {
  const audits: (AuditWrite & { id: string })[] = [];
  const calls: string[] = [];
  let lookups = 0;
  const deps: McpDeps = {
    now: () => new Date("2026-01-15T15:00:00.000Z"),
    store: {
      async findAgentByHash(secretHash) {
        lookups += 1;
        return agents.find((item) => item.secretHash === secretHash) ?? null;
      },
      async insertAudit(row) {
        const id = `audit-${audits.length + 1}`;
        audits.push({ ...row, id });
        return { id };
      },
      async finishAudit(id, resultCode) {
        const row = audits.find((item) => item.id === id);
        if (!row) throw new Error("missing audit");
        row.resultCode = resultCode;
      },
    },
    tools: {
      async run(ctx) {
        calls.push(ctx.tool);
        const pending = audits.find(
          (item) => item.tool === ctx.tool && item.resultCode === "pending",
        );
        assert.ok(pending, "audit row must exist before the tool runs");
        if (runner) return runner(ctx);
        return { resultCode: "ok", isError: false, value: { ran: ctx.tool } };
      },
    },
  };
  return { deps, audits, calls, lookups: () => lookups };
}

function post(body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://boltz.example/api/public/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("a missing, bad, or JWT bearer is 401 and does not reveal the token", async () => {
  const { deps, audits, lookups } = harness([agent()]);
  const missing = await handleMcpRequest(
    post({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    deps,
  );
  assert.equal(missing.status, 401);
  const missingBody = await missing.text();
  assert.equal(missingBody.includes(TOKEN), false);
  assert.equal(lookups(), 0);

  const bad = await handleMcpRequest(
    post({ jsonrpc: "2.0", id: 1, method: "initialize" }, "not-a-real-agent-token"),
    deps,
  );
  assert.equal(bad.status, 401);
  assert.equal((await bad.text()).includes("not-a-real-agent-token"), false);

  const jwt = await handleMcpRequest(
    post({ jsonrpc: "2.0", id: 1, method: "initialize" }, "aaaa.bbbb.cccc"),
    deps,
  );
  assert.equal(jwt.status, 401);
  assert.equal(audits.length, 0);
});

test("a revoked or expired credential is 401 and writes an audit row", async () => {
  const revoked = harness([agent({ revokedAt: "2026-10-01T00:00:00.000Z" })]);
  const response = await handleMcpRequest(
    post(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boltz_lookup_lead" } },
      TOKEN,
    ),
    revoked.deps,
  );
  assert.equal(response.status, 401);
  assert.equal(revoked.calls.length, 0);
  assert.equal(revoked.audits.length, 1);
  assert.equal(revoked.audits[0]?.resultCode, "revoked");
  assert.equal(revoked.audits[0]?.tool, "boltz_lookup_lead");

  const expired = harness([agent({ expiresAt: "2020-01-01T00:00:00.000Z" })]);
  const expiredResponse = await handleMcpRequest(
    post({ jsonrpc: "2.0", id: 1, method: "initialize" }, TOKEN),
    expired.deps,
  );
  assert.equal(expiredResponse.status, 401);
  assert.equal(expired.audits[0]?.resultCode, "expired");
});

test("initialize and tools/list are audited and scoped", async () => {
  const { deps, audits } = harness([agent({ scopes: ["read"] })]);
  const init = await handleMcpRequest(
    post(
      { jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      TOKEN,
    ),
    deps,
  );
  assert.equal(init.status, 200);
  const initBody = (await init.json()) as {
    result: { serverInfo: { name: string }; protocolVersion: string };
  };
  assert.equal(initBody.result.serverInfo.name, "boltz-insight");
  assert.equal(initBody.result.protocolVersion, "2025-06-18");
  assert.equal(audits[0]?.resultCode, "ok");
  assert.equal(audits[0]?.tool, "initialize");

  const listed = await handleMcpRequest(
    post({ jsonrpc: "2.0", id: 8, method: "tools/list" }, TOKEN),
    deps,
  );
  const listedBody = (await listed.json()) as { result: { tools: { name: string }[] } };
  const names = listedBody.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("boltz_lookup_lead"));
  assert.ok(names.includes("boltz_whoami"));
  assert.equal(names.includes("boltz_send_sms"), false);
  assert.equal(names.includes("boltz_update_lead"), false);
});

test("a read credential cannot send, and a send runs only after the audit row", async () => {
  const readOnly = harness([agent({ scopes: ["read"] })]);
  const denied = await handleMcpRequest(
    post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "boltz_send_sms",
          arguments: {
            botName: "lead-follow-up",
            text: "secret body that must not be audited",
            phone: "+13125550100",
            idempotencyKey: "follow-up-example-1",
          },
        },
      },
      TOKEN,
    ),
    readOnly.deps,
  );
  assert.equal(denied.status, 200);
  const deniedBody = (await denied.json()) as {
    result: { isError: boolean; content: { text: string }[] };
  };
  assert.equal(deniedBody.result.isError, true);
  assert.match(deniedBody.result.content[0]?.text ?? "", /not allowed/);
  assert.equal(readOnly.calls.length, 0);
  assert.equal(readOnly.audits[0]?.resultCode, "forbidden");
  const audited = JSON.stringify(readOnly.audits[0]?.argsSummary);
  assert.equal(audited.includes("secret body"), false);
  assert.equal(audited.includes("3125550100"), false);
  assert.equal(readOnly.audits[0]?.argsSummary["textLength"] !== undefined, true);

  const sender = harness([agent({ scopes: ["send"] })]);
  const allowed = await handleMcpRequest(
    post(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "boltz_send_sms", arguments: { botName: "lead-follow-up" } },
      },
      TOKEN,
    ),
    sender.deps,
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual(sender.calls, ["boltz_send_sms"]);
  assert.equal(sender.audits[0]?.resultCode, "ok");
});

test("an audit insert failure refuses the tool", async () => {
  const { deps, calls } = harness([agent({ scopes: ["read"] })]);
  deps.store.insertAudit = async () => ({ error: "audit insert failed" });
  const response = await handleMcpRequest(
    post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "boltz_lookup_lead", arguments: {} },
      },
      TOKEN,
    ),
    deps,
  );
  const body = (await response.json()) as {
    result: { isError: boolean; content: { text: string }[] };
  };
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0]?.text ?? "", /Audit log/);
  assert.equal(calls.length, 0);
});

test("shop chat posting requires write scope and retains the credential identity", async () => {
  const input = { jsonrpc: "2.0", id: 10, method: "tools/call", params: {
    name: "boltz_post_shop_message", arguments: { text: "Internal shop question", idempotencyKey: "00000000-0000-4000-8000-000000000001" },
  } };
  const readOnly = harness([agent({ scopes: ["read"] })]);
  const denied = await handleMcpRequest(post(input, TOKEN), readOnly.deps);
  const body = await denied.json() as { result: { isError: boolean } };
  assert.equal(body.result.isError, true);
  assert.equal(readOnly.calls.length, 0);
  const writer = harness([agent({ scopes: ["leads.write"] })], async ctx => {
    assert.equal(ctx.agent.name, "lead-follow-up");
    return { resultCode: "ok", isError: false, value: { channel: "internal_shop_chat", customerSmsSent: false } };
  });
  await handleMcpRequest(post(input, TOKEN), writer.deps);
  assert.deepEqual(writer.calls, ["boltz_post_shop_message"]);
  assert.equal(writer.audits[0]?.resultCode, "ok");
  assert.ok(!JSON.stringify(writer.audits).includes("Internal shop question"));
});

test("the route does not accept the bot API secret", () => {
  const route = readFileSync(join(here, "../../routes/api/public/mcp.ts"), "utf8");
  assert.match(route, /handleMcpRequest/);
  assert.equal(route.includes("BOT_API_SECRET"), false);
  assert.equal(route.includes("X-Bot-Api-Secret"), false);
  assert.equal(route.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(route.includes("CRON_SECRET"), false);
});
