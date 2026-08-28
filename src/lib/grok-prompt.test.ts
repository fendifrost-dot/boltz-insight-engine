import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildGrokChatMessages,
  countUserMessagesWithBody,
  type GrokPromptHistoryMessage,
} from "./grok-prompt.ts";

const systemPrompt = "SYSTEM";
const leadSummary = "LEAD SUMMARY";

function historyMessage(
  overrides: Partial<GrokPromptHistoryMessage> & Pick<GrokPromptHistoryMessage, "id" | "direction" | "body">,
): GrokPromptHistoryMessage {
  return {
    created_at: "2026-08-28T12:00:00.000Z",
    ...overrides,
  };
}

test("empty history includes the current inbound once", () => {
  const messages = buildGrokChatMessages({
    businessSystemPrompt: systemPrompt,
    leadSummaryText: leadSummary,
    history: [],
    inboundBody: "Need an engine quote",
    inboundMessageId: "msg-1",
  });
  assert.equal(countUserMessagesWithBody(messages, "Need an engine quote"), 1);
});

test("latest inbound already present in history is not duplicated", () => {
  const history = [
    historyMessage({ id: "msg-1", direction: "outbound", body: "Hi, this is Boltz." }),
    historyMessage({ id: "msg-2", direction: "inbound", body: "2014 Camry, rough idle" }),
  ];
  const messages = buildGrokChatMessages({
    businessSystemPrompt: systemPrompt,
    leadSummaryText: leadSummary,
    history,
    inboundBody: "2014 Camry, rough idle",
    inboundMessageId: "msg-2",
  });
  assert.equal(countUserMessagesWithBody(messages, "2014 Camry, rough idle"), 1);
  assert.equal(messages.at(-1)?.role, "user");
  assert.equal(messages.at(-1)?.content, "2014 Camry, rough idle");
});

test("repeated customer text as two distinct messages remains chronological", () => {
  const history = [
    historyMessage({ id: "msg-1", direction: "inbound", body: "Any update?" }),
    historyMessage({ id: "msg-2", direction: "outbound", body: "Still reviewing." }),
    historyMessage({ id: "msg-3", direction: "inbound", body: "Any update?" }),
  ];
  const messages = buildGrokChatMessages({
    businessSystemPrompt: systemPrompt,
    leadSummaryText: leadSummary,
    history,
    inboundBody: "Any update?",
    inboundMessageId: "msg-3",
  });
  assert.equal(countUserMessagesWithBody(messages, "Any update?"), 2);
  assert.deepEqual(
    messages.filter((message) => message.role === "user").map((message) => message.content),
    ["Any update?", "Any update?"],
  );
});

test("history preserves chronological ordering", () => {
  const history = [
    historyMessage({ id: "msg-1", direction: "inbound", body: "First" }),
    historyMessage({ id: "msg-2", direction: "outbound", body: "Second" }),
    historyMessage({ id: "msg-3", direction: "inbound", body: "Third" }),
  ];
  const messages = buildGrokChatMessages({
    businessSystemPrompt: systemPrompt,
    leadSummaryText: leadSummary,
    history,
    inboundBody: "Third",
    inboundMessageId: "msg-3",
  });
  assert.deepEqual(
    messages.slice(2).map((message) => message.content),
    ["First", "Second", "Third"],
  );
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("PROMPT_VERSION is bumped for deduplicated prompt assembly", () => {
  const grokSource = readFileSync(join(repoRoot, "src/server/lead-inbox/grok.server.ts"), "utf8");
  assert.match(grokSource, /export const PROMPT_VERSION = "boltz-sms-agent-v3"/);
});

test("agent run insert records PROMPT_VERSION on every run", () => {
  const jobsSource = readFileSync(join(repoRoot, "src/server/lead-inbox/jobs.server.ts"), "utf8");
  assert.match(jobsSource, /prompt_version:\s*PROMPT_VERSION/);
});

test("inbound not yet persisted is still included", () => {
  const history = [
    historyMessage({ id: "msg-1", direction: "outbound", body: "Hello from Boltz" }),
  ];
  const messages = buildGrokChatMessages({
    businessSystemPrompt: systemPrompt,
    leadSummaryText: leadSummary,
    history,
    inboundBody: "Can you look at my car tomorrow?",
  });
  assert.equal(countUserMessagesWithBody(messages, "Can you look at my car tomorrow?"), 1);
});
