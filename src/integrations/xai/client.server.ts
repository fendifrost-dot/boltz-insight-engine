/**
 * Server-only xAI Responses API client for Grok structured decisions.
 */

import { getXaiConfig } from "@/lib/server/env.server";
import { GROK_DECISION_JSON_SCHEMA, grokDecisionSchema, type GrokDecision } from "./schema";

const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";

export class XaiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "XaiError";
    this.code = code;
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj["output_text"] === "string") return obj["output_text"];

  const output = obj["output"];
  if (!Array.isArray(output)) return null;

  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p["type"] === "output_text" && typeof p["text"] === "string") {
        texts.push(p["text"]);
      }
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

export async function createStructuredGrokDecision(input: {
  system: string;
  user: string;
}): Promise<{ decision: GrokDecision; model: string }> {
  const config = getXaiConfig();

  const response = await fetch(XAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      input: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      text: {
        format: {
          type: "json_schema",
          name: GROK_DECISION_JSON_SCHEMA.name,
          strict: true,
          schema: GROK_DECISION_JSON_SCHEMA.schema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new XaiError("xai_http", `xAI Responses API failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  const text = extractOutputText(payload);
  if (!text) {
    throw new XaiError("xai_empty", "xAI response contained no output text");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new XaiError("xai_json", "xAI output was not valid JSON");
  }

  const decision = grokDecisionSchema.parse(parsed);
  return { decision, model: config.model };
}
