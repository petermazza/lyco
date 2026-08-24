"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { StatusBar } from "./StatusBar";

interface Message {
  who: "user" | "bot";
  text: string;
  isAsk?: boolean;
}

export function NewProjectScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { who: "bot", text: "What are you working on? Tell me what you want to get done.", isAsk: true },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [goalCreated, setGoalCreated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    fetch("/api/auth/me", { signal: controller.signal })
      .then((r) => r.json())
      .then((body) => {
        if (!body.user) {
          router.replace("/");
          return;
        }
        setAuthed(true);
      })
      .catch(() => {
        setAuthed(false);
      })
      .finally(() => clearTimeout(timeoutId));
  }, [router]);

  const sentRef = useRef(false);
  useEffect(() => {
    if (authed !== true) return;
    const q = searchParams.get("q");
    if (q && !sentRef.current) {
      sentRef.current = true;
      sendMessage(q);
    }
  }, [searchParams, authed]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { who: "user", text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.who === "user" ? "user" : "assistant",
            content: m.text,
          })),
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
        setMessages((prev) => [...prev, { who: "bot", text: data.text, isAsk: true }]);
      }

      // Check if any tool call created a goal
      if (data.toolCalls?.some((tc: { name: string }) => tc.name === "create_goal")) {
        setGoalCreated(true);
      }
    } catch {
      setMessages((prev) => [...prev, { who: "bot", text: "Something went wrong. Try again." }]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [messages, loading]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  }, [input, sendMessage]);

  const quiet = "color-mix(in srgb, var(--color-text) 28%, transparent)";
  const set = "color-mix(in srgb, var(--color-text) 75%, transparent)";

  if (authed !== true) {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <StatusBar />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite", fontSize: 13, color: "var(--app-text-quiet)" }}>loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <StatusBar />

      <header style={{ flex: "none", padding: "0 20px 14px", display: "flex", alignItems: "center", gap: 14 }}>
        <Link href="/" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44, paddingInline: 0 }}>
          Close
        </Link>
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 35%, transparent)" }}>
            New project
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 16, lineHeight: 1.25, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {goalCreated ? "Goal saved" : "Tell me about it"}
          </div>
        </div>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {messages.map((m, i) => (
          <div key={i}>
            {m.who === "user" && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ maxWidth: "78%", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "10px 14px", fontSize: 15, lineHeight: 1.45, textWrap: "pretty" }}>
                  {m.text}
                </div>
              </div>
            )}
            {m.who === "bot" && !m.isAsk && (
              <div style={{ maxWidth: "88%", fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", textWrap: "pretty" }}>
                {m.text}
              </div>
            )}
            {m.who === "bot" && m.isAsk && (
              <div style={{ maxWidth: "92%", fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 21, lineHeight: 1.3, letterSpacing: "-0.015em", textWrap: "pretty", animation: "noct-in 260ms ease both" }}>
                {m.text}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ maxWidth: "88%", fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 35%, transparent)" }}>
            <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite" }}>thinking…</span>
          </div>
        )}

        {goalCreated && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <Link href="/" className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }}>
              Back to home
            </Link>
          </div>
        )}
      </div>

      <div style={{ flex: "none", padding: "0 20px 34px" }}>
        <div
          style={{
            display: "flex",
            gap: "var(--space-6)",
            padding: "12px 0",
            background: "linear-gradient(to right, transparent, var(--color-divider) 24px, var(--color-divider) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 32%, transparent)" }}>Status</div>
            <div style={{ fontSize: 12.5, marginTop: 3, color: goalCreated ? set : quiet }}>
              {goalCreated ? "goal saved" : "in conversation"}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
          <input
            ref={inputRef}
            className="input"
            style={{ flex: 1, minHeight: 44, borderRadius: 22, background: "transparent" }}
            placeholder={loading ? "…" : "say it in your own words"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <button
            type="submit"
            className="btn btn-secondary btn-icon"
            style={{ width: 44, height: 44, borderRadius: "50%", flex: "none" }}
            aria-label="send"
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
