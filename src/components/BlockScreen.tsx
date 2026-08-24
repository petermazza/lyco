"use client";

import React, { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { StatusBar } from "./StatusBar";

interface ChatMessage {
  who: "user" | "bot";
  text: string;
  ask?: boolean;
}

interface ScriptNode {
  ask: string;
  hint?: string;
  replies: { label: string }[];
}

const blockScript: ScriptNode[] = [
  {
    ask: "No problem. What is in front of you right now?",
    replies: [{ label: "A blank page" }, { label: "A draft I don't like" }],
  },
  {
    ask: "Then the summary is the wrong place to start — it is the last thing you write, not the first. About seventy minutes left. Want the smaller version?",
    replies: [{ label: "Yes, smaller" }, { label: "What is it first" }],
  },
];

const blockProposalText = "List three things you actually did in your last role. Plain sentences, nothing polished.";

type BlockMode = "running" | "help" | "settled" | "closed";

export function BlockScreen() {
  const [mode, setMode] = useState<BlockMode>("running");
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<ChatMessage[]>([]);
  const [task, setTask] = useState("Rewrite the résumé summary");
  const [closed, setClosed] = useState<"done" | "moved" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const blockReply = useCallback((replyIndex: number) => {
    const node = blockScript[step];
    if (!node) return;
    const reply = node.replies[replyIndex];
    setLog((l) => [...l, { who: "bot", text: node.ask, ask: true }, { who: "user", text: reply.label }]);
    setStep((s) => s + 1);
  }, [step]);

  const acceptBlockPlan = useCallback(() => {
    setMode("settled");
    setTask("List three things you did in the last role");
  }, []);

  const closeBlock = useCallback((result: "done" | "moved") => {
    setMode("closed");
    setClosed(result);
  }, []);

  const s = { mode, step, log, task, closed };

  const node = s.mode === "help" && s.step < blockScript.length ? blockScript[s.step] : null;
  const showProposal = s.mode === "help" && s.step >= blockScript.length;
  const displayLog = [...s.log, ...(node ? [{ who: "bot" as const, text: node.ask, ask: true }] : [])];

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 34px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <StatusBar />

        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent)" }}>
              {s.mode === "closed" ? "block closed" : "block running"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", marginTop: 8 }}>
            New job — 5 first rounds
          </div>
        </header>

        <section>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 26, lineHeight: 1.2, letterSpacing: "-0.02em", textWrap: "pretty" }}>
            {s.task}
          </div>
          <div style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 10 }}>
            {s.mode === "settled" ? "about twenty-five minutes in" : "about twenty minutes in"} · ends at 8:30 pm
          </div>
        </section>

        {/* running mode */}
        {s.mode === "running" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => closeBlock("done")}>
              Mark done
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => showToast("moved to tomorrow, 7:00 pm.")}>
              Move it
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => setMode("help")}>
              I don't know how to start
            </button>
          </div>
        )}

        {/* help mode */}
        {s.mode === "help" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
            {displayLog.map((m, i) => (
              <div key={i}>
                {m.who === "user" && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ maxWidth: "78%", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "10px 14px", fontSize: 15, lineHeight: 1.45, textWrap: "pretty" }}>
                      {m.text}
                    </div>
                  </div>
                )}
                {m.who === "bot" && !m.ask && (
                  <div style={{ maxWidth: "88%", fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", textWrap: "pretty" }}>
                    {m.text}
                  </div>
                )}
                {m.who === "bot" && m.ask && (
                  <div style={{ maxWidth: "92%", fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 19, lineHeight: 1.35, letterSpacing: "-0.015em", textWrap: "pretty", animation: "noct-in 260ms ease both" }}>
                    {m.text}
                  </div>
                )}
              </div>
            ))}

            {node && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
                {node.replies.map((r, i) => (
                  <button
                    key={i}
                    className="btn btn-primary"
                    style={{ minHeight: 44, borderRadius: 22, fontSize: 14, paddingInline: "var(--space-6)" }}
                    onClick={() => blockReply(i)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}

            {showProposal && (
              <div style={{ border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent)", marginBottom: 8 }}>start with this</div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 19, lineHeight: 1.3, textWrap: "pretty" }}>
                  {blockProposalText}
                </div>
                <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginTop: 8 }}>
                  fifteen minutes of work, and the summary writes itself off the back of it.
                </div>
                <button className="btn btn-secondary" style={{ minHeight: 46, fontSize: 15, width: "100%", marginTop: "var(--space-6)" }} onClick={acceptBlockPlan}>
                  Okay, starting that
                </button>
              </div>
            )}
          </div>
        )}

        {/* settled mode */}
        {s.mode === "settled" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <div style={{ fontSize: 15, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", textWrap: "pretty" }}>
              That is the block now. I will check in at 8:30 — nothing else to decide.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => closeBlock("done")}>
                Mark done
              </button>
              <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={() => closeBlock("moved")}>
                Move it
              </button>
            </div>
          </div>
        )}

        {/* closed mode */}
        {s.mode === "closed" && (
          <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>
              {s.closed === "done" ? "Kept. that is the block." : "Moved to tomorrow, 7:00 pm."}
            </div>
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 6, textWrap: "pretty" }}>
              {s.closed === "done" ? "next block is Saturday at 9:30 am." : "your calendar is updated. nothing else changes."}
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
          {s.mode === "help" ? "this conversation ends with one thing to do." : "nothing else is due today."}
        </div>
      </div>

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
