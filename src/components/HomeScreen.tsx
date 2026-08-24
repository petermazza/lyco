"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { StatusBar } from "./StatusBar";

// ─── Types ───────────────────────────────────────────────────

interface HomeData {
  greeting: string;
  dateLabel: string;
  currentBlock: {
    id: string;
    title: string;
    meta: string;
    progress: string;
    elapsed: string;
    left: string;
  } | null;
  laterToday: { time: string; title: string; len: string }[];
  spending: {
    label: string;
    figure: string;
    barWidth: string;
    barColor: string;
    note: string;
    markerLeft?: string;
  }[];
  upcoming: { id: string; title: string; daysAway: number; note: string | null }[];
  kept: number;
  total: number;
}

type LoadState = "loading" | "loaded" | "error";

const moveOptions = [
  { label: "Later today", hint: "6:45 pm", target: "later_today" as const },
  { label: "Tomorrow morning", hint: "9:00 am", target: "tomorrow_morning" as const },
  { label: "Give it 15 more minutes", hint: "you are mid-block", target: "add_15" as const },
  { label: "Drop it this week", hint: "no explanation needed", target: "drop" as const },
];

// ─── Skeleton helpers ────────────────────────────────────────

const skeletonStyle: React.CSSProperties = {
  animation: "noct-pulse 1.4s ease-in-out infinite",
  background: "color-mix(in srgb, var(--color-text) 8%, transparent)",
  borderRadius: "var(--radius-sm)",
};

// ─── Component ───────────────────────────────────────────────

export function HomeScreen() {
  const [data, setData] = useState<HomeData | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastEmail, setToastEmail] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const fetchData = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/home");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const json = await res.json();
      setData(json);
      setState("loaded");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((body) => {
        setAuthed(!!body.user);
      })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (authed) fetchData();
  }, [authed, fetchData]);

  // ─── Actions ───────────────────────────────────────────────

  const handleDone = useCallback(async () => {
    if (!data?.currentBlock) return;
    const blockId = data.currentBlock.id;
    showToast("kept.");
    setData((d) => d ? { ...d, currentBlock: null, laterToday: d.laterToday.slice(1) } : d);
    try {
      await fetch(`/api/blocks/${blockId}/done`, { method: "POST" });
      fetchData();
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [data, showToast, fetchData]);

  const handleMove = useCallback(async (target: string) => {
    if (!data?.currentBlock) return;
    const blockId = data.currentBlock.id;
    setMoving(false);
    try {
      const res = await fetch(`/api/blocks/${blockId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const json = await res.json();
      if (json.message) showToast(json.message);
      if (target === "drop") {
        setData((d) => d ? { ...d, currentBlock: null, laterToday: d.laterToday.slice(1) } : d);
      }
      fetchData();
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [data, showToast, fetchData]);

  const handleSignIn = useCallback(async (email: string) => {
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.link) {
        window.location.href = json.link;
      } else {
        setToastEmail(`check your email, ${email}`);
      }
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [showToast]);

  // ─── Render: Not authenticated ─────────────────────────────

  if (authed === false) {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", overflow: "hidden" }}>
        <div style={{ height: "100%", overflowY: "auto", padding: "0 18px 44px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <StatusBar />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "var(--space-6)" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 28, letterSpacing: "-0.02em" }}>lyco</div>
            <div style={{ fontSize: 14, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", textAlign: "center", maxWidth: 260 }}>
              personal accountability, kept honest by a calendar that knows when you slip.
            </div>
            <form
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", width: "100%", maxWidth: 300 }}
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const email = (form.elements.namedItem("email") as HTMLInputElement).value;
                handleSignIn(email);
              }}
            >
              <input
                name="email"
                type="email"
                placeholder="your email"
                className="input"
                style={{ textAlign: "center", minHeight: 48, fontSize: 15 }}
                required
              />
              <button className="btn btn-primary" style={{ minHeight: 48, fontSize: 15, width: "100%" }} type="submit">
                Sign in
              </button>
            </form>
            {toastEmail && (
              <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>{toastEmail}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Main ──────────────────────────────────────────

  const isLoading = state === "loading";
  const hasError = state === "error";
  const d = data;

  const dots: { color: string }[] = [];
  const kept = d?.kept ?? 0;
  const total = d?.total ?? 0;
  for (let i = 0; i < total; i++) {
    dots.push({
      color: i < kept
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

        {/* ─── Header ─────────────────────────────────────────── */}
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "4px 0 0" }}>
          <div>
            <div style={{ fontSize: 19, fontFamily: "var(--font-heading)", fontWeight: 500, letterSpacing: "-0.015em" }}>
              {isLoading ? <span style={{ ...skeletonStyle, display: "inline-block", width: 120, height: 22 }} /> : d?.greeting}
            </div>
            <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginTop: 2 }}>
              {isLoading ? <span style={{ ...skeletonStyle, display: "inline-block", width: 180, height: 14 }} /> : d?.dateLabel}
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Link href="/schedule" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44 }}>
              schedule
            </Link>
            <Link href="/new" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44 }}>
              new
            </Link>
          </div>
        </header>

        {/* ─── Right now ──────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent)" }}>
              right now
            </span>
          </div>

          {isLoading ? (
            <div className="card" style={{ gap: "var(--space-4)", padding: "var(--space-6)", borderRadius: "var(--radius-lg)", border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", background: "var(--color-surface)" }}>
              <div style={{ ...skeletonStyle, height: 30, width: "80%" }} />
              <div style={{ ...skeletonStyle, height: 16, width: "60%" }} />
              <div style={{ ...skeletonStyle, height: 3, width: "100%" }} />
            </div>
          ) : d?.currentBlock ? (
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
                    {d.currentBlock.title}
                  </div>
                </Link>
                <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginTop: 6 }}>
                  {d.currentBlock.meta}
                </div>
              </div>

              <div>
                <div style={{ height: 3, borderRadius: 2, background: "color-mix(in srgb, var(--color-text) 10%, transparent)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: d.currentBlock.progress, background: "var(--color-accent-500)", borderRadius: 2 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", marginTop: 6 }}>
                  <span>{d.currentBlock.elapsed}</span>
                  <span>{d.currentBlock.left}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <button className="btn btn-primary" style={{ flex: 1, minHeight: 46, fontSize: 15 }} onClick={handleDone}>
                  Done
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, minHeight: 46, fontSize: 15 }} onClick={() => setMoving(true)}>
                  Move it
                </button>
              </div>
            </div>
          ) : (
            <div
              className="card"
              style={{
                gap: "var(--space-4)",
                padding: "var(--space-6)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--color-divider)",
                background: "var(--color-surface)",
              }}
            >
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 26, lineHeight: 1.15, letterSpacing: "-0.02em", textWrap: "pretty" }}>
                  Nothing scheduled right now
                </div>
                <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginTop: 6 }}>
                  the time is yours.
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ─── Later today ────────────────────────────────────── */}
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Later today</h6>
          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: "flex", gap: 14, padding: "10px 0" }}>
                  <span style={{ ...skeletonStyle, width: 62, height: 16 }} />
                  <span style={{ ...skeletonStyle, flex: 1, height: 16 }} />
                </div>
              ))}
            </div>
          ) : d && d.laterToday.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {d.laterToday.map((item, i) => (
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
          ) : (
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 40%, transparent)", padding: "10px 0" }}>
              nothing else today.
            </div>
          )}
        </section>

        {/* ─── Spending ───────────────────────────────────────── */}
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Spending this month</h6>
          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {[0, 1].map((i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
                    <span style={{ ...skeletonStyle, width: 80, height: 16 }} />
                    <span style={{ ...skeletonStyle, width: 70, height: 14 }} />
                  </div>
                  <div style={{ ...skeletonStyle, height: 8, borderRadius: 4, width: "100%" }} />
                </div>
              ))}
            </div>
          ) : d && d.spending.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {d.spending.map((cat, i) => (
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
          ) : (
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 40%, transparent)", padding: "10px 0" }}>
              no spending goals yet.
            </div>
          )}
        </section>

        {/* ─── Coming up ──────────────────────────────────────── */}
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Coming up</h6>
          {isLoading ? (
            <div className="card" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-4) var(--space-6)", background: "transparent", border: "1px solid var(--color-divider)" }}>
              <div style={{ ...skeletonStyle, width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div style={{ ...skeletonStyle, height: 16, width: "60%", marginBottom: 6 }} />
                <div style={{ ...skeletonStyle, height: 12, width: "80%" }} />
              </div>
            </div>
          ) : d && d.upcoming.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {d.upcoming.map((occ) => (
                <div
                  key={occ.id}
                  className="card"
                  style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-4) var(--space-6)", background: "transparent", border: "1px solid var(--color-divider)" }}
                >
                  <div style={{ textAlign: "center", flex: "none" }}>
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 30, lineHeight: 1, color: "var(--color-accent-300)", fontVariantNumeric: "tabular-nums" }}>{occ.daysAway}</div>
                    <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 40%, transparent)", marginTop: 4 }}>days</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, lineHeight: 1.25 }}>{occ.title}</div>
                    {occ.note && (
                      <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginTop: 3, textWrap: "pretty" }}>
                        {occ.note}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 40%, transparent)", padding: "10px 0" }}>
              nothing coming up.
            </div>
          )}
        </section>

        {/* ─── Footer ─────────────────────────────────────────── */}
        {isLoading ? (
          <footer
            style={{
              marginTop: "auto",
              paddingTop: "var(--space-6)",
              background:
                "linear-gradient(to right, transparent, var(--color-divider) 24px, var(--color-divider) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
            }}
          >
            <div style={{ ...skeletonStyle, height: 12, width: 200 }} />
          </footer>
        ) : d && d.total > 0 ? (
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
              you kept {d.kept} of {d.total} blocks this month.
            </div>
          </footer>
        ) : d ? (
          <footer
            style={{
              marginTop: "auto",
              paddingTop: "var(--space-6)",
              background:
                "linear-gradient(to right, transparent, var(--color-divider) 24px, var(--color-divider) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
            }}
          >
            <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 40%, transparent)", textWrap: "pretty" }}>
              no blocks this month yet.
            </div>
          </footer>
        ) : null}

        {hasError && (
          <div style={{ fontSize: 13, color: "var(--color-neutral-400)", textAlign: "center", padding: "var(--space-4) 0" }}>
            something went wrong loading your data. <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={fetchData}>try again</button>
          </div>
        )}
      </div>

      {/* ─── Move sheet ────────────────────────────────────────── */}
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
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 50%, transparent)", marginBottom: "var(--space-6)" }}>
              the block stays the same size. your calendar updates too.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {moveOptions.map((opt) => (
                <button
                  key={opt.target}
                  className="btn btn-secondary"
                  style={{ justifyContent: "space-between", minHeight: 48, fontSize: 15, width: "100%" }}
                  onClick={() => handleMove(opt.target)}
                >
                  <span>{opt.label}</span>
                  <span style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 45%, transparent)", fontWeight: 400 }}>{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast ─────────────────────────────────────────────── */}
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
            border: "1px solid var(--color-divider)",
            animation: "noct-fade 240ms ease both",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
