"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ACCEPT_ATTACHMENTS,
  MAX_ATTACHMENTS,
  readFileAsAttachment,
  type ChatAttachment,
} from "@/lib/attachments";
import { SideChatSheet, type SideChatTurn } from "./SideChatSheet";

interface Message {
  who: "user" | "bot";
  text: string;
  isAsk?: boolean;
  attachments?: { name: string }[];
}

interface ModelOption {
  id: string;
  label: string;
  blurb: string;
}

export function NewProjectScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { who: "bot", text: "What's on your mind? A goal, a purchase, or a date worth remembering — say it plainly.", isAsk: true },
  ]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [goalCreated, setGoalCreated] = useState(false);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [picking, setPicking] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [sideMessages, setSideMessages] = useState<SideChatTurn[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

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
        // Fetch the model lineup for the picker
        fetch("/api/user/model")
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => {
            if (body?.model) setModel(body.model);
            if (Array.isArray(body?.models)) setModels(body.models);
          })
          .catch(() => {});
      })
      .catch(() => {
        setAuthed(false);
      })
      .finally(() => clearTimeout(timeoutId));
  }, [router]);

  const pickModel = useCallback(async (id: string) => {
    setPicking(false);
    try {
      const res = await fetch("/api/user/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "something went wrong. try again.");
        return;
      }
      setModel(json.model);
      const label = models.find((m) => m.id === json.model)?.label ?? json.model;
      showToast(`using ${label.toLowerCase()} now.`);
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [models, showToast]);

  const sentRef = useRef(false);
  useEffect(() => {
    if (authed !== true) return;
    const q = searchParams.get("q");
    if (q && !sentRef.current) {
      sentRef.current = true;
      sendMessage(q);
    }
  }, [searchParams, authed]);

  const sendMessage = useCallback(async (text: string, atts: ChatAttachment[] = []) => {
    if ((!text.trim() && atts.length === 0) || loading) return;

    const userMsg: Message = {
      who: "user",
      text: text.trim() || "See attached.",
      attachments: atts.length ? atts.map((a) => ({ name: a.name })) : undefined,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setPendingAttachments([]);
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m, i) => ({
            role: m.who === "user" ? "user" : "assistant",
            content: m.text,
            // Only the message being sent carries file bytes — earlier
            // bubbles keep just the names.
            attachments:
              i === newMessages.length - 1 && atts.length ? atts : undefined,
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
      const created = data.toolResults?.find(
        (r: { tool: string; success: boolean; data?: { goal_id?: string } }) =>
          r.tool === "create_goal" && r.success
      );
      if (created) {
        setGoalCreated(true);
        if (created.data?.goal_id) setGoalId(created.data.goal_id);
      }
    } catch {
      setMessages((prev) => [...prev, { who: "bot", text: "Something went wrong. Try again." }]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [messages, loading]);

  const handleFilesPicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length) return;
      if (pendingAttachments.length + files.length > MAX_ATTACHMENTS) {
        showToast("up to 3 files at a time.");
        return;
      }
      for (const file of files) {
        const { attachment, error } = await readFileAsAttachment(file);
        if (error || !attachment) {
          showToast(error ?? "that file didn't work. try another.");
          continue;
        }
        setPendingAttachments((prev) => [...prev, attachment]);
      }
    },
    [pendingAttachments.length, showToast]
  );

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input, pendingAttachments);
  }, [input, pendingAttachments, sendMessage]);

  const quiet = "color-mix(in srgb, var(--color-text) 28%, transparent)";
  const set = "color-mix(in srgb, var(--color-text) 75%, transparent)";

  if (authed !== true) {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite", fontSize: 13, color: "var(--app-text-quiet)" }}>loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header style={{ flex: "none", padding: "0 20px 14px", display: "flex", alignItems: "center", gap: 14 }}>
        <Link href="/" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44, paddingInline: 0 }}>
          Close
        </Link>
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 35%, transparent)" }}>
            New
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
                  {m.attachments?.map((a) => (
                    <div
                      key={a.name}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        padding: "3px 9px",
                        marginBottom: 6,
                        marginRight: 6,
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--app-hairline)",
                        color: "var(--app-text-muted)",
                      }}
                    >
                      {a.name}
                    </div>
                  ))}
                  <div>{m.text}</div>
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
            {goalId && (
              <Link href={`/schedule?goal=${goalId}`} className="btn btn-primary" style={{ minHeight: 48, fontSize: 15, width: "100%" }}>
                find time for this
              </Link>
            )}
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
          {model && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 13, minHeight: 44, flex: "none" }}
              onClick={() => setPicking(true)}
            >
              model: {models.find((m) => m.id === model)?.label ?? model}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 13, minHeight: 44, flex: "none" }}
            onClick={() => setSideOpen(true)}
          >
            {sideMessages.some((m) => m.who === "user")
              ? `side chat · ${sideMessages.filter((m) => m.who === "user").length}`
              : "side chat"}
          </button>
        </div>

        {pendingAttachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "var(--space-3)" }}>
            {pendingAttachments.map((att, i) => (
              <span
                key={`${att.name}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  padding: "4px 6px 4px 10px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--app-hairline)",
                  color: "var(--app-text-muted)",
                }}
              >
                {att.name}
                <button
                  type="button"
                  aria-label={`remove ${att.name}`}
                  onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTACHMENTS}
            onChange={handleFilesPicked}
            style={{ display: "none" }}
          />
          <button
            type="button"
            aria-label="attach"
            className="btn btn-ghost btn-icon"
            style={{ width: 44, height: 44, borderRadius: "50%", flex: "none" }}
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor">
              <path d="M209.66 122.34a8 8 0 0 1 0 11.32l-82.05 82a56 56 0 0 1-79.2-79.21l99.31-99.31a40 40 0 1 1 56.57 56.55l-98.35 98.34a24 24 0 0 1-33.94-33.94l77.17-77.16a8 8 0 1 1 11.31 11.32l-77.15 77.16a8 8 0 0 0 11.31 11.32l98.35-98.34a24 24 0 0 0-33.94-33.94L59.7 127.36a40 40 0 0 0 56.58 56.56Z" />
            </svg>
          </button>
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
            disabled={loading || (!input.trim() && pendingAttachments.length === 0)}
          >
            <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor">
              <path d="M210 128a10 10 0 0 1-5.7 9l-152 72a10 10 0 0 1-13.7-12l22-79-22-79a10 10 0 0 1 13.7-12l152 72a10 10 0 0 1 5.7 9Zm-30 0-131-62 18 62Zm-113 62 131-62H85Z" />
            </svg>
          </button>
        </form>
      </div>

      {/* model picker sheet */}
      {picking && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 50, background: "color-mix(in srgb, #0b0d16 62%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
          onClick={() => setPicking(false)}
        >
          <div
            style={{
              background: "var(--color-surface)",
              borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
              padding: "var(--space-6) var(--space-6) var(--space-8)",
              animation: "noct-sheet 220ms cubic-bezier(.2,.8,.3,1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 34, height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--color-text) 18%, transparent)", margin: "0 auto var(--space-6)" }} />
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 18, marginBottom: "var(--space-2)" }}>Which model should answer?</div>
            <div style={{ fontSize: 13, color: "var(--app-text-muted)", marginBottom: "var(--space-6)" }}>
              if one is acting up, another can take over.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {models.map((m) => (
                <button
                  key={m.id}
                  className="btn btn-secondary"
                  style={{
                    justifyContent: "space-between",
                    minHeight: 48,
                    fontSize: "var(--app-size-body)",
                    width: "100%",
                    outline: m.id === model ? "1px solid var(--color-accent)" : undefined,
                  }}
                  onClick={() => pickModel(m.id)}
                >
                  <span>{m.label}{m.id === model ? " · now" : ""}</span>
                  <span style={{ fontSize: 12, color: "var(--app-text-quiet)", fontWeight: 400 }}>{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* side chat sheet */}
      <SideChatSheet
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        messages={sideMessages}
        setMessages={setSideMessages}
        mainMessages={messages.map((m) => ({
          role: (m.who === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.text,
          attachments: m.attachments,
        }))}
        onToolResults={(toolResults) => {
          const created = toolResults.find(
            (r) => r.tool === "create_goal" && r.success
          );
          if (created) {
            setGoalCreated(true);
            if (created.data?.goal_id) setGoalId(created.data.goal_id as string);
          }
        }}
      />

      {/* toast */}
      {toast && (
        <div
          style={{
            position: "absolute",
            left: 18,
            right: 18,
            bottom: 44,
            zIndex: 60,
            background: "var(--color-surface)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
            fontSize: 13,
            border: "1px solid var(--app-hairline)",
            animation: "noct-fade 240ms ease both",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
