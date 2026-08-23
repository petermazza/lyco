"use client";

import React from "react";
import Link from "next/link";
import { useApp, moveOptions } from "@/context/AppContext";
import { StatusBar } from "./StatusBar";

export function HomeScreen() {
  const app = useApp();
  const cur = app.queue[0];

  const dots: { color: string }[] = [];
  for (let i = 0; i < app.total; i++) {
    dots.push({
      color: i < app.kept
        ? "var(--color-accent-500)"
        : "color-mix(in srgb, var(--color-text) 16%, transparent)",
    });
  }

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          overflowY: "auto",
          padding: "0 18px 44px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
        }}
      >
        <StatusBar />

        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "4px 0 0" }}>
          <div>
            <div style={{ fontSize: 19, fontFamily: "var(--font-heading)", fontWeight: 500, letterSpacing: "-0.015em" }}>
              {app.greeting}
            </div>
            <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginTop: 2 }}>
              saturday 23 august · 2:10 pm
            </div>
          </div>
          <Link href="/new" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44 }}>
            new
          </Link>
        </header>

        {/* right now */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent)" }}>
              right now
            </span>
          </div>

          <div
            className="card"
            style={{
              gap: "var(--space-4)",
              padding: "var(--space-6)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)",
              background: "var(--color-surface)",
            }}
          >
            <div>
              <Link href="/block" style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 26, lineHeight: 1.15, letterSpacing: "-0.02em", textWrap: "pretty" }}>
                  {cur ? cur.title : "Nothing scheduled until 6:00"}
                </div>
              </Link>
              <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginTop: 6 }}>
                {cur ? cur.meta : "the afternoon is yours"}
              </div>
            </div>

            <div>
              <div style={{ height: 3, borderRadius: 2, background: "color-mix(in srgb, var(--color-text) 10%, transparent)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: cur ? cur.progress : "0%", background: "var(--color-accent-500)", borderRadius: 2 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", marginTop: 6 }}>
                <span>{cur ? cur.elapsed : ""}</span>
                <span>{cur ? cur.left : ""}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <button className="btn btn-primary" style={{ flex: 1, minHeight: 46, fontSize: 15 }} onClick={app.markDone}>
                Done
              </button>
              <button className="btn btn-secondary" style={{ flex: 1, minHeight: 46, fontSize: 15 }} onClick={app.openMove}>
                Move it
              </button>
            </div>
          </div>
        </section>

        {/* later today */}
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Later today</h6>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {app.later.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 14,
                  padding: "10px 0",
                  background:
                    "linear-gradient(to right, transparent, color-mix(in srgb, var(--color-text) 8%, transparent) 24px, color-mix(in srgb, var(--color-text) 8%, transparent) calc(100% - 24px), transparent) no-repeat bottom / 100% 1px",
                }}
              >
                <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "color-mix(in srgb, var(--color-text) 45%, transparent)", width: 62, flex: "none" }}>
                  {item.time}
                </span>
                <span style={{ fontSize: 15, lineHeight: 1.3, flex: 1, textWrap: "pretty" }}>{item.title}</span>
                <span style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 35%, transparent)" }}>{item.len}</span>
              </div>
            ))}
          </div>
        </section>

        {/* spending */}
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Spending this month</h6>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            {app.spending.map((cat, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 15 }}>{cat.label}</span>
                  <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
                    {cat.figure}
                  </span>
                </div>
                <div style={{ position: "relative", height: 8, borderRadius: 4, background: "color-mix(in srgb, var(--color-text) 9%, transparent)", marginTop: 9, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: cat.barWidth, borderRadius: 4, background: cat.barColor }} />
                  {cat.markerLeft && (
                    <div style={{ position: "absolute", top: -2, bottom: -2, left: cat.markerLeft, width: 1, background: "color-mix(in srgb, var(--color-text) 40%, transparent)" }} />
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", marginTop: 7 }}>{cat.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* coming up */}
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Coming up</h6>
          <div
            className="card"
            style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-4) var(--space-6)", background: "transparent", border: "1px solid var(--color-divider)" }}
          >
            <div style={{ textAlign: "center", flex: "none" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 30, lineHeight: 1, color: "var(--color-accent-300)", fontVariantNumeric: "tabular-nums" }}>12</div>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 40%, transparent)", marginTop: 4 }}>days</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, lineHeight: 1.25 }}>Mom's birthday</div>
              <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginTop: 3, textWrap: "pretty" }}>
                gift idea logged: the ceramics class. order by the 30th to arrive in time.
              </div>
            </div>
          </div>
        </section>

        {/* footer */}
        <footer
          style={{
            marginTop: "auto",
            paddingTop: "var(--space-6)",
            background:
              "linear-gradient(to right, transparent, var(--color-divider) 24px, var(--color-divider) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 9, flexWrap: "wrap" }}>
            {dots.map((dot, i) => (
              <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: dot.color }} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", textWrap: "pretty" }}>
            you kept {app.kept} of {app.total} blocks this month.
          </div>
        </footer>
      </div>

      {/* move sheet */}
      {app.moving && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 50, background: "color-mix(in srgb, #0b0d16 62%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
          onClick={app.cancelMove}
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
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginBottom: "var(--space-6)" }}>
              the block stays the same size. your calendar updates too.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {moveOptions.map((opt, i) => (
                <button
                  key={i}
                  className="btn btn-secondary"
                  style={{ justifyContent: "space-between", minHeight: 48, fontSize: 15, width: "100%" }}
                  onClick={() => app.executeMove(i)}
                >
                  <span>{opt.label}</span>
                  <span style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", fontWeight: 400 }}>{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {app.toast && (
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
            border: "1px solid var(--color-divider)",
            animation: "noct-fade 240ms ease both",
          }}
        >
          {app.toast}
        </div>
      )}
    </div>
  );
}
