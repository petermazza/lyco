"use client";

import React, { useRef, useEffect } from "react";
import Link from "next/link";
import { useApp, newProjectScript } from "@/context/AppContext";
import { StatusBar } from "./StatusBar";

export function NewProjectScreen() {
  const app = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);

  const node = newProjectScript[app.newProjectStep];
  const log = node
    ? [...app.newProjectLog, { who: "bot" as const, text: node.ask, ask: true }]
    : app.newProjectLog;

  const cap = app.newProjectLog.reduce<Record<string, string>>((acc, m) => {
    if (m.cap) Object.assign(acc, m.cap);
    return acc;
  }, {});

  const quiet = "color-mix(in srgb, var(--color-text) 28%, transparent)";
  const set = "color-mix(in srgb, var(--color-text) 75%, transparent)";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [app.newProjectStep, app.newProjectLog]);

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
            {cap.head || "Untitled"}
          </div>
        </div>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {log.map((m, i) => (
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
              <div style={{ maxWidth: "92%", fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 21, lineHeight: 1.3, letterSpacing: "-0.015em", textWrap: "pretty", animation: "noct-in 260ms ease both" }}>
                {m.text}
              </div>
            )}
          </div>
        ))}

        {node && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", paddingTop: "var(--space-2)" }}>
            {node.replies.map((r, i) => (
              <button
                key={i}
                className="btn btn-primary"
                style={{ minHeight: 44, borderRadius: 22, fontSize: 14, paddingInline: "var(--space-6)" }}
                onClick={() => {
                  app.newProjectReply(i);
                  if (r.done) {
                    window.location.href = "/schedule";
                  }
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {!node && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <Link href="/schedule" className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }}>
              Review schedule proposal
            </Link>
            <Link href="/" className="btn btn-ghost" style={{ fontSize: 14, minHeight: 44 }}>
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
            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 32%, transparent)" }}>Title</div>
            <div style={{ fontSize: 12.5, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: cap.title ? set : quiet }}>
              {cap.title || "waiting"}
            </div>
          </div>
          <div style={{ flex: "none", width: 96 }}>
            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 32%, transparent)" }}>Deadline</div>
            <div style={{ fontSize: 12.5, marginTop: 3, color: cap.deadline ? set : quiet }}>{cap.deadline || "—"}</div>
          </div>
          <div style={{ flex: "none", width: 88 }}>
            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 32%, transparent)" }}>Cadence</div>
            <div style={{ fontSize: 12.5, marginTop: 3, color: cap.cadence ? set : quiet }}>{cap.cadence || "—"}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
          <input className="input" style={{ flex: 1, minHeight: 44, borderRadius: 22, background: "transparent" }} placeholder={node ? node.hint : "anything else?"} />
          <button className="btn btn-secondary btn-icon" style={{ width: 44, height: 44, borderRadius: "50%", flex: "none" }} aria-label="send">
            <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor">
              <path d="M210 128a10 10 0 0 1-5.7 9l-152 72a10 10 0 0 1-13.7-12l22-79-22-79a10 10 0 0 1 13.7-12l152 72a10 10 0 0 1 5.7 9Zm-30 0-131-62 18 62Zm-113 62 131-62H85Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
