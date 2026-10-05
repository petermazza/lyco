"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface Slot {
  weekday: number;
  day: string;
  start: string;
  time: string;
  durationMinutes: number;
  history: string;
}

interface Proposal {
  goal: { id: string; title: string; deadline: string | null; weeksLeft: number | null };
  reasoning: string;
  sessions: string;
  calendarConnected: boolean;
  slots: Slot[];
}

export function ScheduleProposalScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const goalId = searchParams.get("goal");

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalState, setProposalState] = useState<"loading" | "loaded" | "error">("loading");
  const [perWeek, setPerWeek] = useState<1 | 2>(2);
  const [variant, setVariant] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);

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

  const fetchProposal = useCallback(async (weeks: number, v: number) => {
    const gen = ++fetchGen.current;
    setProposalState("loading");
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const params = new URLSearchParams({ perWeek: String(weeks), variant: String(v) });
      if (goalId) params.set("goalId", goalId);
      const res = await fetch(`/api/schedule/proposal?${params}`, { signal: controller.signal });
      if (gen !== fetchGen.current) return;
      if (res.status === 404) {
        router.replace("/new");
        return;
      }
      if (!res.ok) {
        setProposalState("error");
        return;
      }
      const data = await res.json();
      setProposal(data);
      setProposalState("loaded");
    } catch {
      if (gen === fetchGen.current) setProposalState("error");
    } finally {
      clearTimeout(timeoutId);
    }
  }, [goalId, router]);

  useEffect(() => {
    if (authed === true) fetchProposal(perWeek, variant);
  }, [authed, perWeek, variant, fetchProposal]);

  const handleAccept = useCallback(async () => {
    if (!proposal || proposal.slots.length === 0) return;
    setConfirming(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId: proposal.goal.id,
          goalTitle: proposal.goal.title,
          slots: proposal.slots.map((s) => ({
            start: s.start,
            durationMinutes: s.durationMinutes,
            title: `${proposal.goal.title} — work session`,
          })),
        }),
        signal: controller.signal,
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
      clearTimeout(timeoutId);
      setConfirming(false);
    }
  }, [proposal]);

  const handleConnectCalendar = useCallback(async () => {
    const res = await fetch("/api/calendar/connect");
    const data = await res.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    }
  }, []);

  if (authed !== true || proposalState === "loading") {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ animation: "noct-pulse 1.4s ease-in-out infinite", fontSize: 13, color: "var(--app-text-quiet)" }}>
            {proposalState === "error" ? "something went wrong." : "finding your open times…"}
          </span>
        </div>
      </div>
    );
  }

  if (!proposal) return null;

  const goal = proposal.goal;
  const calendarConnected = proposal.calendarConnected;

  return (
    <div className="mobile-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 34px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

        <header>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 20, lineHeight: 1.25, letterSpacing: "-0.015em", textWrap: "pretty" }}>
            {goal.title}
          </div>
          {goal.deadline && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>
              <span>by {new Date(goal.deadline + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "long" })}</span>
              {goal.weeksLeft !== null && (
                <>
                  <span style={{ width: 3, height: 3, borderRadius: "50%", background: "color-mix(in srgb, var(--color-text) 30%, transparent)" }} />
                  <span>{goal.weeksLeft} weeks left</span>
                </>
              )}
            </div>
          )}
        </header>

        <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17, lineHeight: 1.4, letterSpacing: "-0.01em", color: "var(--color-accent-300)", textWrap: "pretty" }}>
          {proposal.reasoning}
        </p>

        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Proposed times</h6>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {proposal.slots.map((slot, i) => (
              <div key={i} data-testid="slot" style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-lg)", padding: "var(--space-6)", animation: "noct-in 240ms ease both" }}>
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
            {proposal.slots.length === 0 && (
              <div style={{ fontSize: "var(--app-size-body)", color: "var(--app-text-secondary)", padding: "10px 0" }}>
                no clear openings in the next few weeks.
              </div>
            )}
          </div>
        </section>

        {!calendarConnected && !confirmed && (
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
              disabled={confirming || proposal.slots.length === 0}
              onClick={handleAccept}
            >
              {confirming ? "Confirming…" : "Accept these times"}
            </button>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 48, fontSize: 15, width: "100%" }}
              onClick={() => setVariant((v) => v + 1)}
            >
              Pick different times
            </button>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 48, fontSize: 15, width: "100%" }}
              onClick={() => {
                setVariant(0);
                setPerWeek((p) => (p === 2 ? 1 : 2));
              }}
            >
              {perWeek === 2 ? "Go less often" : "Go more often"}
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
          <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>{proposal.sessions}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-text) 40%, transparent)", textWrap: "pretty" }}>
            confirming locks the deadline. changing it later is allowed, and it goes on this project's record permanently.
          </div>
        </footer>
      </div>
    </div>
  );
}
