// Streamable HTTP MCP handler. Auth and audit live here. Tool I/O is injected.
import {
  INSTRUCTIONS,
  LATEST_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  agentIsActive,
  agentMayCall,
  bearerToken,
  hashEquals,
  looksLikeJwt,
  negotiatedProtocol,
  safeResultCode,
  sha256Hex,
  summarizeToolArgs,
  tokenShapeOk,
  toolDefinition,
  toolsForScopes,
  type McpAgent,
  type McpStore,
  type McpToolRunner,
  type ToolOutcome,
} from "./protocol.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

const MAX_BODY = 20_000;

export interface McpDeps {
  store: McpStore;
  tools: McpToolRunner;
  now?: () => Date;
}

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS,
      ...extra,
    },
  });
}

function authError(message: string): Response {
  return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, 401);
}

function wantsSse(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  if (!accept) return false;
  if (accept.includes("application/json") || accept.includes("*/*")) return false;
  return accept.includes("text/event-stream");
}

function rpcResponse(
  request: Request,
  id: string | number | null,
  payload: { result?: unknown; error?: { code: number; message: string } },
  protocol: string,
  status = 200,
): Response {
  const body = { jsonrpc: "2.0", id, ...payload };
  const extra = { "MCP-Protocol-Version": protocol };
  if (!wantsSse(request) || status !== 200 || payload.error) return json(body, status, extra);
  const sse = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  return new Response(sse, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      ...CORS,
      ...extra,
    },
  });
}

function toolResult(outcome: ToolOutcome): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(outcome.value) }],
    isError: outcome.isError,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rpcId(msg: Record<string, unknown>): string | number | null {
  const id = msg["id"];
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function logFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : "mcp request failed";
  console.error("[mcp]", message.replace(/\+?\d{7,}/g, "[redacted]").slice(0, 200));
}

async function audit(
  store: McpStore,
  row: { agentId: string; tool: string; argsSummary: Record<string, unknown>; resultCode: string },
): Promise<{ id: string } | null> {
  try {
    const inserted = await store.insertAudit({
      ...row,
      resultCode: safeResultCode(row.resultCode),
    });
    if ("error" in inserted) return null;
    return inserted;
  } catch (error) {
    logFailure(error);
    return null;
  }
}

export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...CORS } });
  }
  if (request.method === "GET") {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "POST JSON-RPC to this URL" } },
      405,
    );
  }
  if (request.method !== "POST") {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Method not allowed" } },
      405,
    );
  }

  const token = bearerToken(request);
  if (!token) return authError("Unauthorized");
  if (looksLikeJwt(token) || !tokenShapeOk(token)) return authError("Unauthorized");

  const now = deps.now ?? (() => new Date());
  const computed = sha256Hex(token);
  let agent: McpAgent | null = null;
  try {
    agent = await deps.store.findAgentByHash(computed);
  } catch (error) {
    logFailure(error);
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "request failed" } },
      500,
    );
  }
  if (!agent || !hashEquals(agent.secretHash, computed)) return authError("Unauthorized");

  const activity = agentIsActive(agent, now());
  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body is too large" } },
      413,
    );
  }

  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (activity !== "active") {
    const peek = isRecord(parsed) ? parsed : {};
    const params = isRecord(peek["params"]) ? peek["params"] : {};
    const tool =
      peek["method"] === "tools/call" && typeof params["name"] === "string"
        ? params["name"].slice(0, 80)
        : typeof peek["method"] === "string"
          ? peek["method"].slice(0, 80)
          : activity;
    await audit(deps.store, {
      agentId: agent.id,
      tool,
      argsSummary: summarizeToolArgs(isRecord(params["arguments"]) ? params["arguments"] : {}),
      resultCode: activity,
    });
    return authError("Unauthorized");
  }

  if (parsed === undefined) {
    await audit(deps.store, {
      agentId: agent.id,
      tool: "parse_error",
      argsSummary: {},
      resultCode: "invalid",
    });
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (Array.isArray(parsed)) {
    await audit(deps.store, {
      agentId: agent.id,
      tool: "batch",
      argsSummary: { count: parsed.length },
      resultCode: "invalid",
    });
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "batch requests are not supported" },
      },
      400,
    );
  }
  if (!isRecord(parsed) || parsed["jsonrpc"] !== "2.0" || typeof parsed["method"] !== "string") {
    await audit(deps.store, {
      agentId: agent.id,
      tool: "invalid_request",
      argsSummary: {},
      resultCode: "invalid",
    });
    return rpcResponse(
      request,
      isRecord(parsed) ? rpcId(parsed) : null,
      { error: { code: -32600, message: "Invalid request" } },
      "2025-03-26",
      400,
    );
  }

  return handleMessage(request, parsed, agent, deps, now());
}

async function handleMessage(
  request: Request,
  msg: Record<string, unknown>,
  agent: McpAgent,
  deps: McpDeps,
  now: Date,
): Promise<Response> {
  const id = rpcId(msg);
  const method = String(msg["method"]);
  const headerProtocol =
    negotiatedProtocol(request.headers.get("mcp-protocol-version")) ?? "2025-03-26";
  const params = isRecord(msg["params"]) ? msg["params"] : {};
  const args = isRecord(params["arguments"]) ? params["arguments"] : {};

  if (method.startsWith("notifications/")) {
    const inserted = await audit(deps.store, {
      agentId: agent.id,
      tool: method.slice(0, 80),
      argsSummary: {},
      resultCode: "pending",
    });
    if (!inserted) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32603, message: "request failed" } },
        500,
      );
    }
    try {
      await deps.store.finishAudit(inserted.id, "ok");
    } catch (error) {
      logFailure(error);
    }
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store", ...CORS } });
  }

  let toolName = method.slice(0, 80);
  if (method === "tools/call") {
    toolName = typeof params["name"] === "string" ? params["name"].slice(0, 80) : "tools/call";
  }

  const inserted = await audit(deps.store, {
    agentId: agent.id,
    tool: toolName,
    argsSummary: summarizeToolArgs(method === "tools/call" ? args : params),
    resultCode: "pending",
  });
  if (!inserted) {
    const refused: ToolOutcome = {
      resultCode: "error",
      isError: true,
      value: { error: "Audit log did not record this call, so it was refused." },
    };
    if (method === "tools/call") {
      return rpcResponse(request, id, { result: toolResult(refused) }, headerProtocol);
    }
    return rpcResponse(
      request,
      id,
      {
        error: { code: -32603, message: "Audit log did not record this call, so it was refused." },
      },
      headerProtocol,
      500,
    );
  }

  let outcome: ToolOutcome;
  try {
    outcome = await dispatchMethod(method, params, args, agent, deps, now);
  } catch (error) {
    logFailure(error);
    outcome = { resultCode: "error", isError: true, value: { error: "request failed" } };
  }

  try {
    await deps.store.finishAudit(inserted.id, safeResultCode(outcome.resultCode));
  } catch (error) {
    logFailure(error);
  }

  if (method === "initialize" || method === "ping" || method === "tools/list") {
    if (outcome.isError) {
      return rpcResponse(
        request,
        id,
        { error: { code: -32603, message: "request failed" } },
        headerProtocol,
        500,
      );
    }
    const protocol =
      method === "initialize" &&
      isRecord(outcome.value) &&
      typeof outcome.value["protocolVersion"] === "string"
        ? outcome.value["protocolVersion"]
        : headerProtocol;
    return rpcResponse(request, id, { result: outcome.value }, protocol);
  }

  if (method !== "tools/call") {
    return rpcResponse(
      request,
      id,
      { error: { code: -32601, message: "Method not found" } },
      headerProtocol,
    );
  }

  return rpcResponse(request, id, { result: toolResult(outcome) }, headerProtocol);
}

async function dispatchMethod(
  method: string,
  params: Record<string, unknown>,
  args: Record<string, unknown>,
  agent: McpAgent,
  deps: McpDeps,
  now: Date,
): Promise<ToolOutcome> {
  if (method === "initialize") {
    const protocol = negotiatedProtocol(params["protocolVersion"]) ?? LATEST_PROTOCOL_VERSION;
    return {
      resultCode: "ok",
      isError: false,
      value: {
        protocolVersion: protocol,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      },
    };
  }
  if (method === "ping") return { resultCode: "ok", isError: false, value: {} };
  if (method === "tools/list") {
    return {
      resultCode: "ok",
      isError: false,
      value: {
        tools: toolsForScopes(agent.scopes).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    };
  }
  if (method === "tools/call") {
    const name = params["name"];
    if (typeof name !== "string") {
      return { resultCode: "unknown_tool", isError: true, value: { error: "unknown tool" } };
    }
    const def = toolDefinition(name);
    if (!def)
      return { resultCode: "unknown_tool", isError: true, value: { error: "unknown tool" } };
    if (!agentMayCall(agent, def)) {
      return {
        resultCode: "forbidden",
        isError: true,
        value: { error: "agent is not allowed to use this tool" },
      };
    }
    if (name === "boltz_whoami") {
      return {
        resultCode: "ok",
        isError: false,
        value: { agent: agent.name, scopes: agent.scopes },
      };
    }
    return deps.tools.run({ agent, tool: name, args, now });
  }
  return { resultCode: "unknown_method", isError: true, value: { error: "unknown method" } };
}
