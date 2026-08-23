"use client";

import React from "react";
import Link from "next/link";
import { useApp, schedulePlans } from "@/context/AppContext";
import { StatusBar } from "./StatusBar";

export function ScheduleProposalScreen() {
  const app = useApp();
  const plan = schedulePlans[app.schedulePace];

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 34px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <StatusBar />

        <header>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 20, lineHeight: 1.25, letterSpacing: "-0.015em", textWrap: "pretty" }}>
            New job — 5 first rounds
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>
            <span>by 31 october</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "color-mix(in srgb, var(--color-text) 30%, transparent)" }} />
            <span>9 weeks left</span>
          </div>
        </header>

        <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17, lineHeight: 1.4, letterSpacing: "-0.01em", color: "var(--color-accent-300)", textWrap: "pretty" }}>
          {plan.reasoning}
        </p>

        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Proposed times</h6>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {plan.slots.map((slot, i) => (
              <div key={i} style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 240ms ease both" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 18, letterSpacing: "-0.01em" }}>{slot.day}</span>
                  <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>{slot.time}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--color-accent-500)", flex: "none" }} />
                  <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", textWrap: "pretty" }}>{slot.history}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {!app.scheduleConfirmed && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={app.acceptSchedule}>
              Accept these times
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={app.pickDifferentTimes}>
              Pick different times
            </button>
            <button className="btn btn-secondary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} onClick={app.togglePace}>
              Go less often
            </button>
          </div>
        )}

        {app.scheduleConfirmed && (
          <div style={{ border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>Set. the blocks are in your calendar.</div>
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 6, textWrap: "pretty" }}>
              the deadline is locked from here. you can still move any single block.
            </div>
            <Link href="/" className="btn btn-secondary" style={{ marginTop: "var(--space-6)", minHeight: 46, fontSize: 15, width: "100%" }}>
              Back to home
            </Link>
          </div>
        )}

        <footer
          style={{
            marginTop: "auto",
            paddingTop: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            background: "linear-gradient(to right, transparent, var(--color-divider) 24px, var(--color-divider) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
          }}
        >
          <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>{plan.sessions}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 40%, transparent)", textWrap: "pretty" }}>
            confirming locks the deadline. changing it later is allowed, and it goes on this project's record permanently.
          </div>
        </footer>
      </div>
    </div>
  );
}
