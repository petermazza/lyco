"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deriveSections, type SectionVisibility } from "@/lib/homeSections";

// ─── Types ───────────────────────────────────────────────────

interface HomeData {
  greeting: string;
  dateLabel: string;
  hasGoals: boolean;
  calendarConnected: boolean;
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

const firstRunExamples = [
  { text: "I want to find a new job" },
  { text: "I want to stop eating out five nights a week" },
];

// ─── Skeleton helpers ────────────────────────────────────────

const skeletonStyle: React.CSSProperties = {
  animation: "noct-pulse 1.4s ease-in-out infinite",
  background: "var(--app-skeleton)",
  borderRadius: "var(--radius-sm)",
};

// ─── Component ───────────────────────────────────────────────

export function HomeScreen() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastEmail, setToastEmail] = useState<string | null>(null);
  const [firstRunInput, setFirstRunInput] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const fetchData = useCallback(async () => {
    setState("loading");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch("/api/home", { signal: controller.signal });
      if (res.status === 401) {
        setAuthed(false);
        setState("loaded");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const json = await res.json();
      setData(json);
      setAuthed(true);
      setState("loaded");
    } catch {
      setState("error");
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      if (!res.ok) {
        setToastEmail(json.error ?? "something went wrong. try again.");
        return;
      }
      if (json.link) {
        window.location.href = json.link;
      } else {
        setToastEmail(`check your email, ${email}`);
      }
    } catch {
      showToast("something went wrong. try again.");
    }
  }, [showToast]);

  const startChat = useCallback((text: string) => {
    const q = text.trim();
    if (!q) return;
    router.push(`/new?q=${encodeURIComponent(q)}`);
  }, [router]);

  // ─── Render: Not authenticated ─────────────────────────────

  if (authed === false) {
    return (
      <div className="mobile-shell" style={{ position: "relative", height: "100dvh", overflow: "hidden" }}>
        <div style={{ height: "100%", overflowY: "auto", padding: "0 18px 44px", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "var(--space-6)" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 28, letterSpacing: "-0.02em" }}>lyco</div>
            <div style={{ fontSize: 14, color: "var(--app-text-muted)", textAlign: "center", maxWidth: 260 }}>
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
              <div style={{ fontSize: 13, color: "var(--app-text-muted)" }}>{toastEmail}</div>
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

  const sections: SectionVisibility = d
    ? deriveSections(d)
    : { firstRun: false, rightNow: false, laterToday: false, spending: false, comingUp: false };

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
        {/* ─── Header ─────────────────────────────────────────── */}
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "4px 0 0" }}>
          <div>
            <div style={{ fontSize: 19, fontFamily: "var(--font-heading)", fontWeight: 500, letterSpacing: "-0.015em" }}>
              {isLoading ? <span style={{ ...skeletonStyle, display: "inline-block", width: 120, height: 22 }} /> : d?.greeting}
            </div>
            <div style={{ fontSize: "var(--app-size-meta)", color: "var(--app-text-muted)", marginTop: 2 }}>
              {isLoading ? <span style={{ ...skeletonStyle, display: "inline-block", width: 180, height: 14 }} /> : sections.firstRun ? "nothing set up yet, and that's fine" : d?.dateLabel}
            </div>
          </div>
          {!sections.firstRun && (
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Link href="/schedule" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44 }}>
                schedule
              </Link>
              <Link href="/new" className="btn btn-ghost" style={{ fontSize: 13, minHeight: 44 }}>
                new
              </Link>
            </div>
          )}
        </header>

        {/* ─── Loading ─────────────────────────────────────────── */}
        {isLoading && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)", animation: "noct-breathe 1.7s ease-in-out infinite" }}>
            <div style={{ height: 22, width: "74%", borderRadius: "var(--radius-sm)", background: "var(--app-skeleton-strong)" }} />
            <div style={{ height: 12, width: "46%", borderRadius: "var(--radius-sm)", background: "var(--app-skeleton)" }} />
            <div style={{ height: 3, borderRadius: 2, background: "var(--app-skeleton)" }} />
          </div>
        )}

        {/* ─── First run ───────────────────────────────────────── */}
        {!isLoading && sections.firstRun && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "var(--space-8)", paddingBottom: "8vh", animation: "noct-in 280ms ease both" }}>
            <div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 29, lineHeight: 1.2, letterSpacing: "-0.02em", textWrap: "pretty" }}>
                What's the one thing you'd like to get moving?
              </div>
              <div style={{ fontSize: "var(--app-size-body)", lineHeight: 1.55, color: "var(--app-text-secondary)", marginTop: "var(--space-4)", textWrap: "pretty" }}>
                Say it however it sounds in your head. I'll ask a couple of questions, then find the time for it.
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {firstRunExamples.map((ex) => (
                <button
                  key={ex.text}
                  className="btn btn-ghost"
                  style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", minHeight: "var(--app-tap-min)", padding: "13px var(--space-6)", border: "1px solid var(--app-hairline)", borderRadius: "var(--radius-lg)", fontSize: "var(--app-size-body)", lineHeight: 1.4, color: "var(--app-text-secondary)", fontWeight: 400 }}
                  onClick={() => startChat(ex.text)}
                >
                  {ex.text}
                </button>
              ))}
            </div>

            <form
              style={{ display: "flex", alignItems: "center", gap: "var(--app-stack-gap)" }}
              onSubmit={(e) => {
                e.preventDefault();
                startChat(firstRunInput);
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minHeight: 48, borderRadius: 24, background: "transparent" }}
                placeholder="type it here"
                value={firstRunInput}
                onChange={(e) => setFirstRunInput(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-secondary btn-icon"
                style={{ width: 48, height: 48, borderRadius: "50%", flex: "none" }}
                aria-label="start"
                disabled={!firstRunInput.trim()}
              >
                <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor"><path d="M210 128a10 10 0 0 1-5.7 9l-152 72a10 10 0 0 1-13.7-12l22-79-22-79a10 10 0 0 1 13.7-12l152 72a10 10 0 0 1 5.7 9Zm-30 0-131-62 18 62Zm-113 62 131-62H85Z" /></svg>
              </button>
            </form>
          </div>
        )}

        {/* ─── Right now ──────────────────────────────────────── */}
        {!isLoading && sections.rightNow && (
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
            <span style={{ fontSize: "var(--app-size-eyebrow)", letterSpacing: "var(--app-eyebrow-track)", textTransform: "uppercase", color: "var(--color-accent)" }}>
              right now
            </span>
          </div>

          {d?.currentBlock ? (
            <div
              className="card"
              style={{
                gap: "var(--space-4)",
                padding: "var(--space-6)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--app-prominent-border)",
                background: "var(--color-surface)",
              }}
            >
              <div>
                <Link href="/block" style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: "var(--app-size-display)", lineHeight: 1.15, letterSpacing: "-0.02em", textWrap: "pretty" }}>
                    {d.currentBlock.title}
                  </div>
                </Link>
                <div style={{ fontSize: 13, color: "var(--app-text-muted)", marginTop: 6 }}>
                  {d.currentBlock.meta}
                </div>
              </div>

              <div>
                <div style={{ height: 3, borderRadius: 2, background: "var(--app-track)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: d.currentBlock.progress, background: "var(--app-bar-on-pace)", borderRadius: 2 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--app-text-quiet)", marginTop: 6 }}>
                  <span>{d.currentBlock.elapsed}</span>
                  <span>{d.currentBlock.left}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <button className="btn btn-primary" style={{ flex: 1, minHeight: 46, fontSize: "var(--app-size-body)" }} onClick={handleDone}>
                  Done
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, minHeight: 46, fontSize: "var(--app-size-body)" }} onClick={() => setMoving(true)}>
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
                border: "1px solid var(--app-hairline)",
                background: "var(--color-surface)",
              }}
            >
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: "var(--app-size-display)", lineHeight: 1.15, letterSpacing: "-0.02em", textWrap: "pretty" }}>
                  Nothing scheduled right now
                </div>
                <div style={{ fontSize: 13, color: "var(--app-text-muted)", marginTop: 6 }}>
                  the time is yours.
                </div>
              </div>
            </div>
          )}
        </section>
        )}

        {/* ─── Later today ────────────────────────────────────── */}
        {!isLoading && sections.laterToday && (
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Later today</h6>
          {d && d.laterToday.length > 0 ? (
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
                  <span style={{ fontSize: "var(--app-size-meta)", fontVariantNumeric: "tabular-nums", color: "var(--app-text-quiet)", width: 62, flex: "none" }}>
                    {item.time}
                  </span>
                  <span style={{ fontSize: "var(--app-size-body)", lineHeight: 1.3, flex: 1, textWrap: "pretty" }}>{item.title}</span>
                  <span style={{ fontSize: "var(--app-size-micro)", color: "var(--app-text-quiet)" }}>{item.len}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "var(--app-size-body)", color: "var(--app-text-secondary)", padding: "10px 0" }}>
              nothing else today.
            </div>
          )}
        </section>
        )}

        {/* ─── Spending ───────────────────────────────────────── */}
        {!isLoading && sections.spending && (
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Spending this month</h6>
          {d && d.spending.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {d.spending.map((cat, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: "var(--app-size-body)" }}>{cat.label}</span>
                    <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "var(--app-text-secondary)" }}>
                      {cat.figure}
                    </span>
                  </div>
                  <div style={{ position: "relative", height: "var(--app-bar-height)", borderRadius: 4, background: "var(--app-track)", marginTop: 9, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: cat.barWidth, borderRadius: 4, background: cat.barColor }} />
                    {cat.markerLeft && (
                      <div style={{ position: "absolute", top: -2, bottom: -2, left: cat.markerLeft, width: 1, background: "color-mix(in srgb, var(--color-text) 40%, transparent)" }} />
                    )}
                  </div>
                  <div style={{ fontSize: "var(--app-size-micro)", color: "var(--app-text-quiet)", marginTop: 7 }}>{cat.note}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {/* ─── Coming up ──────────────────────────────────────── */}
        {!isLoading && sections.comingUp && (
        <section>
          <h6 style={{ margin: "0 0 var(--space-4)", color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}>Coming up</h6>
          {d && d.upcoming.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {d.upcoming.map((occ) => (
                <div
                  key={occ.id}
                  className="card"
                  style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-4) var(--space-6)", background: "transparent", border: "1px solid var(--app-hairline)" }}
                >
                  <div style={{ textAlign: "center", flex: "none" }}>
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 30, lineHeight: 1, color: "var(--app-text-accent)", fontVariantNumeric: "tabular-nums" }}>{occ.daysAway}</div>
                    <div style={{ fontSize: "var(--app-size-eyebrow)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--app-text-quiet)", marginTop: 4 }}>days</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--app-size-body)", lineHeight: 1.25 }}>{occ.title}</div>
                    {occ.note && (
                      <div style={{ fontSize: "var(--app-size-meta)", color: "var(--app-text-muted)", marginTop: 3, textWrap: "pretty" }}>
                        {occ.note}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {/* ─── Footer ─────────────────────────────────────────── */}
        {!isLoading && !sections.firstRun && (
          <footer
            style={{
              marginTop: "auto",
              paddingTop: "var(--space-6)",
              background:
                "linear-gradient(to right, transparent, var(--app-hairline) 24px, var(--app-hairline) calc(100% - 24px), transparent) no-repeat top / 100% 1px",
            }}
          >
            {d && d.total > 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 9, flexWrap: "wrap" }}>
                  {dots.map((dot, i) => (
                    <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: dot.color }} />
                  ))}
                </div>
                <div style={{ fontSize: "var(--app-size-meta)", color: "var(--app-text-muted)", textWrap: "pretty" }}>
                  you kept {d.kept} of {d.total} blocks this month.
                </div>
              </>
            ) : (
              <div style={{ fontSize: "var(--app-size-meta)", color: "var(--app-text-muted)", textWrap: "pretty" }}>
                no blocks this month yet.
              </div>
            )}
          </footer>
        )}

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
