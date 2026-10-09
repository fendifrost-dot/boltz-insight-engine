import { Link, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, MessageCircle, RotateCcw, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getShopChat, sendShopChat } from "@/lib/desk-chat.functions";
import type { ShopChatMessage } from "@/lib/desk-chat";

export function DeskChat({ expanded = false }: { expanded?: boolean }) {
  const read = useServerFn(getShopChat);
  const send = useServerFn(sendShopChat);
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { leadId?: string };
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [reply, setReply] = useState<ShopChatMessage | null>(null);
  const retry = useRef<{ text: string; key: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const chat = useQuery({
    queryKey: ["shop-chat"],
    queryFn: () => read(),
    refetchInterval: live ? 20_000 : 5_000,
    retry: 1,
  });

  useEffect(() => {
    const channel = supabase
      .channel("shop-desk-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "desk_chat_messages" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["shop-chat"] });
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat.data?.messages.length, busy]);

  async function submit(text = draft) {
    text = text.trim();
    if (!text || busy) return;
    if (!retry.current || retry.current.text !== text)
      retry.current = { text, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    follow.current = true;
    try {
      await send({
        data: {
          text,
          idempotencyKey: retry.current.key,
          leadId: search.leadId ?? reply?.leadId ?? null,
          replyTo: reply?.id ?? null,
        },
      });
      setDraft("");
      setReply(null);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: ["shop-chat"] });
    } catch {
      setError(
        "Could not finish sending. Your message may already be saved; retrying won’t duplicate it.",
      );
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <section className={`desk-chat ${expanded ? "is-expanded" : ""}`}>
      <header className="desk-chat-header">
        <span className="desk-grok-avatar">
          <Zap size={22} fill="currentColor" />
        </span>
        <div>
          <h2>Grok</h2>
          <p>Your shop assistant</p>
        </div>
        <span
          className={`desk-connection ${live ? "is-live" : ""}`}
          title={live ? "Messages update live" : "Checking for messages every few seconds"}
        >
          {live ? "Live chat" : "Connecting"}
        </span>
      </header>
      <div className="desk-chat-scope">
        <MessageCircle size={14} /> Shared with the shop & connected agents
      </div>
      <div
        className="desk-chat-log"
        role="log"
        aria-label="Shop conversation"
        aria-live="polite"
        ref={log}
        onScroll={() => {
          if (log.current)
            follow.current =
              log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 100;
        }}
      >
        {chat.isPending ? (
          <p className="desk-muted">Opening shop chat…</p>
        ) : chat.isError ? (
          <div className="desk-chat-welcome">
            <h3>Chat couldn’t connect.</h3>
            <p>Your customer records are still available from the desk.</p>
            <button
              type="button"
              className="desk-button secondary"
              onClick={() => void chat.refetch()}
            >
              <RotateCcw size={16} />
              Try again
            </button>
          </div>
        ) : (
          <>
            {!chat.data.messages.length && (
              <div className="desk-chat-welcome">
                <span className="desk-welcome-mark">
                  <Zap size={28} />
                </span>
                <h3>A little help at the counter.</h3>
                <p>
                  Ask for a customer by name or phone number, check today’s visits, or leave a
                  question for the shop.
                </p>
              </div>
            )}
            {chat.data.messages.map((message) => (
              <article
                key={message.id}
                className={`desk-chat-message ${message.role === "staff" ? "from-staff" : ""} ${message.role === "system" ? "is-system" : ""}`}
              >
                <div className="desk-chat-author">
                  <span>{message.sender}</span>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString("en-US", {
                      timeZone: "America/Chicago",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="desk-chat-bubble">{message.body}</div>
                <div className="desk-message-actions">
                  {message.leadId && (
                    <Link to="/desk/leads/$leadId" params={{ leadId: message.leadId }}>
                      Open customer
                    </Link>
                  )}
                  {message.role === "agent" && (
                    <button
                      type="button"
                      onClick={() => {
                        setReply(message);
                        input.current?.focus();
                      }}
                    >
                      Reply
                    </button>
                  )}
                </div>
              </article>
            ))}
          </>
        )}
        {busy && (
          <p role="status" className="desk-chat-thinking">
            <span />
            Grok is checking…
          </p>
        )}
      </div>
      {!chat.isError && (
        <div className="desk-chat-suggestions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("Who is scheduled to come in today?")}
          >
            Today’s visits
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft("Find the customer with phone number ");
              input.current?.focus();
            }}
          >
            Find a customer
          </button>
        </div>
      )}
      <form
        className="desk-chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {search.leadId && <p className="desk-chat-context">Asking about the selected customer</p>}
        {reply && (
          <div className="desk-reply-preview">
            <span>
              Replying to {reply.sender}: {reply.body.slice(0, 70)}
            </span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="desk-error">
            {error}
          </p>
        )}
        <div className="desk-composer-field">
          <textarea
            ref={input}
            aria-label="Message Grok and the shop"
            placeholder="Ask Grok or message the shop…"
            value={draft}
            maxLength={2000}
            rows={2}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button type="submit" aria-label="Send message" disabled={busy || !draft.trim()}>
            <ArrowUp size={20} />
          </button>
        </div>
        <p className="desk-chat-footnote">Internal chat · Customer texts stay separate</p>
      </form>
    </section>
  );
}
