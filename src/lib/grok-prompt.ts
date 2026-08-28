export type GrokPromptHistoryMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  created_at?: string;
};

export type GrokChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Build xAI chat messages without duplicating the current inbound turn. */
export function buildGrokChatMessages(args: {
  businessSystemPrompt: string;
  leadSummaryText: string;
  history: GrokPromptHistoryMessage[];
  inboundBody: string;
  inboundMessageId?: string;
}): GrokChatMessage[] {
  const messages: GrokChatMessage[] = [
    { role: "system", content: args.businessSystemPrompt },
    { role: "system", content: args.leadSummaryText },
  ];

  const inboundAlreadyPersisted =
    Boolean(args.inboundMessageId) &&
    args.history.some((message) => message.id === args.inboundMessageId);

  for (const message of args.history) {
    messages.push({
      role: message.direction === "inbound" ? "user" : "assistant",
      content: message.body ?? "",
    });
  }

  if (!inboundAlreadyPersisted && args.inboundBody.length > 0) {
    messages.push({ role: "user", content: args.inboundBody });
  }

  return messages;
}

/** Count user-role messages with exact body text (for duplicate-text regression tests). */
export function countUserMessagesWithBody(messages: GrokChatMessage[], body: string): number {
  return messages.filter((message) => message.role === "user" && message.content === body).length;
}
