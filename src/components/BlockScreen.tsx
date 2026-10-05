"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────

interface CurrentBlock {
  id: string;
  title: string;
  goalTitle: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  progress: number;
}

interface ChatMessage {
  who: "user" | "bot";
  text: string;
  ask?: boolean;
}

type BlockMode = "running" | "help" | "settled" | "closed";
type LoadState = "loading" | "loaded" | "error";

const moveOptions = [
  { label: "Later today", hint: "this evening", target: "later_today" as const },
  { label: "Tomorrow morning", hint: "9:00 am", target: "tomorrow_morning" as const },
  { label: "Give it 15 more minutes", hint: "ends later", target: "add_15" as const },
  { label: "Drop it this week", hint: "no explanation needed", target: "drop" as const },
];

function formatTime(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// ─── Component ───────────────────────────────────────────────

export function BlockScreen() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [block, setBlock] = useState<CurrentBlock | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const [mode, setMode] = useState<BlockMode>("running");
  const [closed, setClosed] = useState<"done" | "moved">("done");
  const [closedNote, setClosedNote] = useState("");
  const [moving, setMoving] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [log, setLog] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ─── Auth + load ───────────────────────────────────────────

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
      .catch(() => setAuthed(false))
      .finally(() => clearTimeout(timeoutId));
  }, [router]);

  const fetchBlock = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch("/api/blocks/current", { signal: controller.signal });
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const data = await res.json();
      setBlock(data.block);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    if (authed === true) fetchBlock();
  }, [authed, fetchBlock]);

  // Tick the clock while a block is on screen
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, chatLoading]);

  // ─── Derived timing ────────────────────────────────────────

  const start = block ? new Date(block.scheduledAt) : null;
  const end = start ? new Date(start.getTime() + (block?.durationMinutes ?? 0) * 60000) : null;
  const elapsedMin = start ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000)) : 0;
  const leftMin = end ? Math.max(0, Math.floor((end.getTime() - now.getTime()) / 60000)) : 0;

  // ─── Actions ───────────────────────────────────────────────

  const handleDone = useCallback(async () => {
    if (!block) return;
    try {
      const res = await fetch(`/api/blocks/${block.id}/done`, { method: "POST" });
      if (!res.ok) {
        showToast("something went wrong. try again.");
        return;
      }
      setClosed("done");
      setClosedNote("that is the block.");
      setMode("closed");
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [block, showToast]);

  const handleMove = useCallback(async (target: string) => {
    if (!block) return;
    setMoving(false);
    try {
      const res = await fetch(`/api/blocks/${block.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "something went wrong. try again.");
        return;
      }
      if (target === "add_15") {
        if (json.message) showToast(json.message);
        fetchBlock();
      } else {
        setClosed("moved");
        setClosedNote(json.message ?? "moved.");
        setMode("closed");
      }
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [block, showToast, fetchBlock]);

  // ─── Help chat ─────────────────────────────────────────────

  const blockContext = useCallback((): string | undefined => {
    if (!block) return undefined;
    return (
      `The user is in a work block right now. Block id: ${block.id}. ` +
      `Task: "${block.title}".` +
      (block.goalTitle ? ` Goal: "${block.goalTitle}".` : "") +
      ` About ${elapsedMin} of ${block.durationMinutes} minutes elapsed, ${leftMin} left. ` +
      `They tapped "I don't know how to start". Help them find the smallest useful first step that fits the remaining time. ` +
      `Ask what is in front of them first if you need to. When they agree on a step, call update_block with this block's id and the new task as a short plain title.`
    );
  }, [block, elapsedMin, leftMin]);

  const sendChat = useCallback(async (text: string) => {
    if (!text.trim() || chatLoading) return;

    const newLog: ChatMessage[] = [...log, { who: "user", text }];
    setLog(newLog);
    setInput("");
    setChatLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newLog.map((m) => ({
            role: m.who === "user" ? "user" : "assistant",
            content: m.text,
          })),
          context: blockContext(),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        setLog((prev) => [...prev, { who: "bot", text: `Something went wrong: ${err.error}` }]);
        return;
      }

      const data = await res.json();
      if (data.text) {
        setLog((prev) => [...prev, { who: "bot", text: data.text, ask: true }]);
      }

      // If the assistant settled the block on a new task, reflect it
      const rename = data.toolResults?.find(
        (r: { tool: string; success: boolean; data?: { title?: string } }) =>
          r.tool === "update_block" && r.success
      );
      if (rename?.data?.title) {
        setBlock((b) => (b ? { ...b, title: rename.data.title } : b));
        setMode("settled");
      }
    } catch {
      setLog((prev) => [...prev, { who: "bot", text: "Something went wrong. Try again." }]);
    } finally {
      clearTimeout(timeoutId);
      setChatLoading(false);
      inputRef.current?.focus();
    }
  }, [log, chatLoading, blockContext]);

  const startHelp = useCallback(() => {
    setMode("help");
    sendChat("I don't know how to start.");
  }, [sendChat]);

  // ─── Loading / empty ───────────────────────────────────────

  if (authed !== true || loadState === "loading") {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite", fontSize: 13, color: "var(--app-text-quiet)" }}>
            {loadState === "error" ? "something went wrong." : "loading…"}
          </span>
        </div>
      </div>
    );
  }

  if (!block) {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", overflow: "hidden" }}>
        <div style={{ height: "100%", overflowY: "auto", padding: "0 18px 44px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "var(--space-6)", paddingBottom: "8vh", animation: "noct-in 280ms ease both" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: "var(--app-size-display)", lineHeight: 1.15, letterSpacing: "-0.02em", textWrap: "pretty" }}>
              Nothing scheduled right now
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-muted)" }}>
              the time is yours.
            </div>
            <Link href="/" className="btn btn-secondary" style={{ minHeight: 46, fontSize: 15, width: "100%" }}>
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", padding: "0 20px 34px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
      >
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent)" }}>
              {mode === "closed" ? "block closed" : "block running"}
            </span>
          </div>
          {block.goalTitle && (
            <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", marginTop: 8 }}>
              {block.goalTitle}
            </div>
          )}
        </header>

        <section>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 26, lineHeight: 1.2, letterSpacing: "-0.02em", textWrap: "pretty" }}>
            {block.title}
          </div>
          <div style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 10 }}>
            {elapsedMin === 0 ? "just started" : `${elapsedMin} minutes in`} · ends at {end ? formatTime(end) : ""}
          </div>
        </section>

        {/* running mode */}
        {mode === "running" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={handleDone}>
              Mark done
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => setMoving(true)}>
              Move it
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={startHelp} disabled={chatLoading}>
              I don't know how to start
            </button>
          </div>
        )}

        {/* help mode */}
        {mode === "help" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
            {log.map((m, i) => (
              <div key={i}>
                {m.who === "user" && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ maxWidth: "78%", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "10px 14px", fontSize: 15, lineHeight: 1.45, textWrap: "pretty" }}>
                      {m.text}
                    </div>
                  </div>
                )}
                {m.who === "bot" && (
                  <div style={{ maxWidth: "92%", fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 19, lineHeight: 1.35, letterSpacing: "-0.015em", textWrap: "pretty", animation: "noct-in 260ms ease both" }}>
                    {m.text}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div style={{ fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 35%, transparent)" }}>
                <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite" }}>thinking…</span>
              </div>
            )}
          </div>
        )}

        {/* settled mode */}
        {mode === "settled" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <div style={{ fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", textWrap: "pretty" }}>
              That is the block now. {leftMin > 0 ? `${leftMin} minutes left` : "time is about up"} — nothing else to decide.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={handleDone}>
                Mark done
              </button>
              <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => setMoving(true)}>
                Move it
              </button>
            </div>
          </div>
        )}

        {/* closed mode */}
        {mode === "closed" && (
          <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>
              {closed === "done" ? "Kept." : "Moved."}
            </div>
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 6, textWrap: "pretty" }}>
              {closedNote}
            </div>
            <Link href="/" className="btn btn-secondary" style={{ marginTop: "var(--space-6)", minHeight: 46, fontSize: 15, width: "100%" }}>
              Back to home
            </Link>
          </div>
        )}

        <div
          style={{
            marginTop: "auto",
            paddingTop: "var(--space-6)",
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 35%, transparent)",
            background: "linear-gradient(to right, transparent, var(--color-divider) 24px, var(--color-divider) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
          }}
        >
          {mode === "help" ? "this conversation ends with one thing to do." : "nothing else is due right now."}
        </div>
      </div>

      {/* help input */}
      {mode === "help" && (
        <div style={{ flex: "none", padding: "0 20px 34px" }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendChat(input);
            }}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}
          >
            <input
              ref={inputRef}
              className="input"
              style={{ flex: 1, minHeight: 44, borderRadius: 22, background: "transparent" }}
              placeholder={chatLoading ? "…" : "say what is in front of you"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={chatLoading}
            />
            <button
              type="submit"
              className="btn btn-secondary btn-icon"
              style={{ width: 44, height: 44, borderRadius: "50%", flex: "none" }}
              aria-label="send"
              disabled={chatLoading || !input.trim()}
            >
              <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor">
                <path d="M210 128a10 10 0 0 1-5.7 9l-152 72a10 10 0 0 1-13.7-12l22-79-22-79a10 10 0 0 1 13.7-12l152 72a10 10 0 0 1 5.7 9Zm-30 0-131-62 18 62Zm-113 62 131-62H85Z" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* move sheet */}
      {moving && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 50, background: "color-mix(in srgb, #0b0d16 62%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
          onClick={() => setMoving(false)}
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
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 18, marginBottom: "var(--space-2)" }}>Move it where?</div>
            <div style={{ fontSize: 13, color: "var(--app-text-muted)", marginBottom: "var(--space-6)" }}>
              the block stays the same size. your calendar updates too.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {moveOptions.map((opt) => (
                <button
                  key={opt.target}
                  className="btn btn-secondary"
                  style={{ justifyContent: "space-between", minHeight: 48, fontSize: "var(--app-size-body)", width: "100%" }}
                  onClick={() => handleMove(opt.target)}
                >
                  <span>{opt.label}</span>
                  <span style={{ fontSize: 12, color: "var(--app-text-quiet)", fontWeight: 400 }}>{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
