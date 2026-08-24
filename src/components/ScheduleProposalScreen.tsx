"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { StatusBar } from "./StatusBar";

interface Slot {
  day: string;
  time: string;
  history: string;
}

const schedulePlans: Record<number, { reasoning: string; sessions: string; slots: Slot[] }> = {
  2: {
    reasoning: "Twice a week gets you there with room to spare.",
    sessions: "that is 18 sessions before 31 october.",
    slots: [
      { day: "Tuesday", time: "7:00 – 8:30 pm", history: "free on 8 of the last 10 tuesday evenings" },
      { day: "Saturday", time: "9:30 – 11:00 am", history: "free most saturday mornings" },
    ],
  },
  1: {
    reasoning: "Once a week still lands it, with less slack near the end.",
    sessions: "that is 9 sessions before 31 october.",
    slots: [
      { day: "Saturday", time: "9:30 – 11:00 am", history: "free most saturday mornings" },
    ],
  },
};

export function ScheduleProposalScreen() {
  const [pace, setPace] = useState<1 | 2>(2);
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarChecked, setCalendarChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = schedulePlans[pace];

  useEffect(() => {
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then((d) => {
        setCalendarConnected(d.connected ?? false);
        setCalendarChecked(true);
      })
      .catch(() => setCalendarChecked(true));
  }, []);

  const handleAccept = useCallback(async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalTitle: "New job — 5 first rounds",
          slots: plan.slots.map((s) => {
            const timeMatch = s.time.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
            const durationMinutes = timeMatch
              ? (parseInt(timeMatch[3], 10) * 60 + parseInt(timeMatch[4], 10)) - (parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10))
              : 90;
            return {
              day: s.day,
              time: s.time,
              durationMinutes: Math.abs(durationMinutes) || 90,
              title: "New job — work session",
            };
          }),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "request failed" }));
        setError(err.error ?? "Failed to confirm schedule");
        return;
      }

      const data = await res.json();
      setConfirmed(true);

      if (data.errors?.length) {
        setError(`Blocks created, but some calendar events failed: ${data.errors.join(", ")}`);
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setConfirming(false);
    }
  }, [plan.slots]);

  const handleConnectCalendar = useCallback(async () => {
    const res = await fetch("/api/calendar/connect");
    const data = await res.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    }
  }, []);

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

        {calendarChecked && !calendarConnected && !confirmed && (
          <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 240ms ease both" }}>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", textWrap: "pretty" }}>
              Connect Google Calendar to write these blocks to your real calendar. You can still confirm without it — blocks will be saved here only.
            </div>
            <button
              className="btn btn-secondary"
              style={{ marginTop: "var(--space-4)", minHeight: 44, fontSize: 14, width: "100%" }}
              onClick={handleConnectCalendar}
            >
              Connect Google Calendar
            </button>
          </div>
        )}

        {calendarConnected && !confirmed && (
          <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-accent) 70%, transparent)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            Google Calendar connected — events will be written
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: "var(--color-neutral-500)", lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {!confirmed && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 48, fontSize: 15, width: "100%", opacity: confirming ? 0.5 : 1 }}
              disabled={confirming}
              onClick={handleAccept}
            >
              {confirming ? "Confirming…" : "Accept these times"}
            </button>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 48, fontSize: 15, width: "100%" }}
              onClick={() => setConfirmed(false)}
            >
              Pick different times
            </button>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 48, fontSize: 15, width: "100%" }}
              onClick={() => setPace((p) => (p === 2 ? 1 : 2))}
            >
              Go less often
            </button>
          </div>
        )}

        {confirmed && (
          <div style={{ border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 260ms ease both" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>Set. the blocks are in your calendar.</div>
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 6, textWrap: "pretty" }}>
              {calendarConnected
                ? "events written to Google Calendar. you can still move any single block."
                : "blocks saved. connect Google Calendar to sync them to your real calendar."}
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
