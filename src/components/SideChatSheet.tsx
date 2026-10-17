"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────

export interface SideChatTurn {
  who: "user" | "bot";
  text: string;
}

interface SideChatSheetProps {
  open: boolean;
  onClose: () => void;
  messages: SideChatTurn[];
  setMessages: React.Dispatch<React.SetStateAction<SideChatTurn[]>>;
  mainMessages: { role: "user" | "assistant"; content: string; attachments?: { name: string }[] }[];
  context?: string;
  onToolResults?: (
    toolResults: { tool: string; success: boolean; data?: Record<string, unknown> }[]
  ) => void;
}

// ─── Component ───────────────────────────────────────────────
// A bottom sheet that answers asides against the main conversation
// without touching it. The parent owns the message list so history
// survives opening and closing the sheet.

export function SideChatSheet({
  open,
  onClose,
  messages,
  setMessages,
  mainMessages,
  context,
  onToolResults,
}: SideChatSheetProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendSide = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const next: SideChatTurn[] = [...messages, { who: "user", text }];
      setMessages(next);
      setInput("");
      setLoading(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({
              role: m.who === "user" ? "user" : "assistant",
              content: m.text,
            })),
            sideChat: true,
            mainMessages,
            context,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "request failed" }));
          setMessages((prev) => [...prev, { who: "bot", text: `Something went wrong: ${err.error}` }]);
          return;
        }

        const data = await res.json();
        if (data.text) {
          setMessages((prev) => [...prev, { who: "bot", text: data.text }]);
        }
        if (data.toolResults?.length) {
          onToolResults?.(data.toolResults);
        }
      } catch {
        setMessages((prev) => [...prev, { who: "bot", text: "Something went wrong. Try again." }]);
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [messages, loading, setMessages, mainMessages, context, onToolResults]
  );

  if (!open) return null;

  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 50, background: "color-mix(in srgb, #0b0d16 62%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
          padding: "var(--space-6) var(--space-6) var(--space-8)",
          maxHeight: "78dvh",
          display: "flex",
          flexDirection: "column",
          animation: "noct-sheet 220ms cubic-bezier(.2,.8,.3,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 34, height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--color-text) 18%, transparent)", margin: "0 auto var(--space-6)" }} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: "var(--space-4)" }}>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 18 }}>Side chat</div>
            <div style={{ fontSize: 13, color: "var(--app-text-muted)", marginTop: 2 }}>
              ask anything without losing your place.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13, minHeight: 36, paddingInline: 8, flex: "none" }}
            onClick={onClose}
          >
            Done
          </button>
        </div>

        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-4)", padding: "8px 0 14px", minHeight: 120 }}
        >
          {messages.length === 0 && !loading && (
            <div style={{ fontSize: 14, color: "var(--app-text-muted)", lineHeight: 1.5, textWrap: "pretty" }}>
              Ask a question on the side — the main conversation stays right where you left it.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i}>
              {m.who === "user" && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ maxWidth: "82%", background: "var(--color-bg)", borderRadius: "var(--radius-lg)", padding: "10px 14px", fontSize: 15, lineHeight: 1.45, textWrap: "pretty" }}>
                    {m.text}
                  </div>
                </div>
              )}
              {m.who === "bot" && (
                <div style={{ maxWidth: "92%", fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17, lineHeight: 1.35, letterSpacing: "-0.015em", textWrap: "pretty", animation: "noct-in 260ms ease both" }}>
                  {m.text}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 35%, transparent)" }}>
              <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite" }}>thinking…</span>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendSide(input);
          }}
          style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-2)", flex: "none" }}
        >
          <input
            ref={inputRef}
            className="input"
            style={{ flex: 1, minHeight: 44, borderRadius: 22, background: "var(--color-bg)" }}
            placeholder={loading ? "…" : "ask a side question"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="btn btn-secondary btn-icon"
            style={{ width: 44, height: 44, borderRadius: "50%", flex: "none" }}
            aria-label="send side"
            disabled={loading || !input.trim()}
          >
            <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor">
              <path d="M210 128a10 10 0 0 1-5.7 9l-152 72a10 10 0 0 1-13.7-12l22-79-22-79a10 10 0 0 1 13.7-12l152 72a10 10 0 0 1 5.7 9Zm-30 0-131-62 18 62Zm-113 62 131-62H85Z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
