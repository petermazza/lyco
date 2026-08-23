"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────

export interface QueueItem {
  title: string;
  meta: string;
  progress: string;
  elapsed: string;
  left: string;
}

export interface LaterItem {
  time: string;
  title: string;
  len: string;
}

export interface SpendingCategory {
  label: string;
  figure: string;
  barWidth: string;
  barColor: string;
  note: string;
  markerLeft?: string;
}

export interface MoveOption {
  label: string;
  hint: string;
}

export interface ChatMessage {
  who: "user" | "bot";
  text: string;
  ask?: boolean;
  cap?: ProjectCap;
}

export interface ProjectCap {
  title?: string;
  head?: string;
  deadline?: string;
  cadence?: string;
}

export interface ScriptNode {
  ask: string;
  hint?: string;
  replies: {
    label: string;
    cap?: ProjectCap;
    done?: boolean;
  }[];
}

export interface ScheduleSlot {
  day: string;
  time: string;
  history: string;
}

export interface SchedulePlan {
  reasoning: string;
  sessions: string;
  slots: ScheduleSlot[];
}

interface AppState {
  // Home
  greeting: string;
  queue: QueueItem[];
  later: LaterItem[];
  kept: number;
  total: number;
  moving: boolean;
  toast: string | null;
  spending: SpendingCategory[];

  // Block screen
  blockMode: "running" | "help" | "settled" | "closed";
  blockStep: number;
  blockLog: ChatMessage[];
  blockTask: string;
  blockClosed: "done" | "moved" | null;

  // New project
  newProjectStep: number;
  newProjectLog: ChatMessage[];

  // Schedule proposal
  schedulePace: 1 | 2;
  scheduleConfirmed: boolean;

  // Actions
  markDone: () => void;
  openMove: () => void;
  cancelMove: () => void;
  executeMove: (index: number) => void;
  showToast: (msg: string) => void;

  setBlockMode: (mode: AppState["blockMode"]) => void;
  blockReply: (replyIndex: number) => void;
  acceptBlockPlan: () => void;
  closeBlock: (result: "done" | "moved") => void;

  newProjectReply: (replyIndex: number) => void;

  acceptSchedule: () => void;
  pickDifferentTimes: () => void;
  togglePace: () => void;
}

const AppContext = createContext<AppState | null>(null);

// ─── Mock data ───────────────────────────────────────────────

const initialQueue: QueueItem[] = [
  { title: "Draft the SimpleFIN adapter", meta: "90 minutes · until 3:30 · calendar", progress: "22%", elapsed: "20 minutes in", left: "70 minutes left" },
  { title: "Walk, no phone", meta: "30 minutes · until 4:15 · calendar", progress: "0%", elapsed: "starts 3:45", left: "30 minutes" },
  { title: "Write the weekly digest prompt", meta: "45 minutes · until 6:45 · calendar", progress: "0%", elapsed: "starts 6:00", left: "45 minutes" },
];

const initialLater: LaterItem[] = [
  { time: "3:45 pm", title: "Walk, no phone", len: "30m" },
  { time: "6:00 pm", title: "Write the weekly digest prompt", len: "45m" },
  { time: "8:30 pm", title: "Call Dad", len: "20m" },
];

const initialSpending: SpendingCategory[] = [
  {
    label: "Eating out",
    figure: "$186 of $240",
    barWidth: "77.5%",
    barColor: "var(--color-accent-500)",
    note: "about level with the month · 8 days left",
    markerLeft: "74%",
  },
  {
    label: "Rideshare",
    figure: "$92 of $80",
    barWidth: "100%",
    barColor: "var(--color-neutral-500)",
    note: "$12 past the target you set · noted, nothing to do",
  },
];

const moveOptions: MoveOption[] = [
  { label: "Later today", hint: "6:45 pm" },
  { label: "Tomorrow morning", hint: "9:00 am" },
  { label: "Give it 15 more minutes", hint: "you are mid-block" },
  { label: "Drop it this week", hint: "no explanation needed" },
];

const blockScript: ScriptNode[] = [
  {
    ask: "No problem. What is in front of you right now?",
    replies: [
      { label: "A blank page" },
      { label: "A draft I don't like" },
    ],
  },
  {
    ask: "Then the summary is the wrong place to start — it is the last thing you write, not the first. About seventy minutes left. Want the smaller version?",
    replies: [
      { label: "Yes, smaller" },
      { label: "What is it first" },
    ],
  },
];

const blockProposalText = "List three things you actually did in your last role. Plain sentences, nothing polished.";

const newProjectScript: ScriptNode[] = [
  {
    ask: "What would count as done here — a signed offer, or something earlier, like real conversations started?",
    hint: "or say it in your own words",
    replies: [
      { label: "A signed offer", cap: { title: "New job — signed offer", head: "New job — signed offer" } },
      { label: "First-round interviews", cap: { title: "New job — 5 first rounds", head: "New job — 5 first rounds" } },
      { label: "Not sure yet", cap: { title: "New job search", head: "New job search" } },
    ],
  },
  {
    ask: "When do you want that by?",
    hint: "a rough date is fine",
    replies: [
      { label: "End of october", cap: { deadline: "31 oct" } },
      { label: "End of the year", cap: { deadline: "31 dec" } },
      { label: "No date yet", cap: { deadline: "open" } },
    ],
  },
  {
    ask: "How often should I hold time for this?",
    hint: "you can change this later",
    replies: [
      { label: "Twice a week", cap: { cadence: "2× a week" } },
      { label: "Weekday mornings", cap: { cadence: "weekday am" } },
      { label: "Sunday evenings", cap: { cadence: "sundays" } },
    ],
  },
  {
    ask: "That's enough to start. Want me to put the first two blocks on your calendar this week?",
    hint: "or tell me what to change",
    replies: [
      { label: "Yes, schedule them", done: true },
      { label: "Not yet", done: true },
    ],
  },
];

const schedulePlans: Record<number, SchedulePlan> = {
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

// ─── Provider ────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [later, setLater] = useState<LaterItem[]>(initialLater);
  const [kept, setKept] = useState(23);
  const [total, setTotal] = useState(31);
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [blockMode, setBlockMode] = useState<AppState["blockMode"]>("running");
  const [blockStep, setBlockStep] = useState(0);
  const [blockLog, setBlockLog] = useState<ChatMessage[]>([]);
  const [blockTask, setBlockTask] = useState("Rewrite the résumé summary");
  const [blockClosed, setBlockClosed] = useState<"done" | "moved" | null>(null);

  const [newProjectStep, setNewProjectStep] = useState(0);
  const [newProjectLog, setNewProjectLog] = useState<ChatMessage[]>([
    { who: "user", text: "I want to find a new job" },
    { who: "bot", text: "Okay. A few questions and I'll set it up." },
  ]);

  const [schedulePace, setSchedulePace] = useState<1 | 2>(2);
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const markDone = useCallback(() => {
    setQueue((q) => q.slice(1));
    setLater((l) => l.slice(1));
    setKept((k) => k + 1);
    setTotal((t) => t + 1);
    showToast("kept. that is the day.");
  }, [showToast]);

  const openMove = useCallback(() => setMoving(true), []);
  const cancelMove = useCallback(() => setMoving(false), []);

  const executeMove = useCallback((index: number) => {
    setMoving(false);
    const msgs = [
      "moved to 6:45 pm. calendar updated.",
      "moved to tomorrow, 9:00 am.",
      "15 minutes added. until 3:45.",
      "dropped. it will not come back on its own.",
    ];
    if (index === 3) {
      setQueue((q) => q.slice(1));
      setLater((l) => l.slice(1));
    }
    showToast(msgs[index] ?? "moved.");
  }, [showToast]);

  const blockReply = useCallback((replyIndex: number) => {
    const node = blockScript[blockStep];
    if (!node) return;
    const reply = node.replies[replyIndex];
    setBlockLog((log) => [
      ...log,
      { who: "bot", text: node.ask },
      { who: "user", text: reply.label },
    ]);
    setBlockStep((s) => s + 1);
  }, [blockStep]);

  const acceptBlockPlan = useCallback(() => {
    setBlockMode("settled");
    setBlockTask("List three things you did in the last role");
  }, []);

  const closeBlock = useCallback((result: "done" | "moved") => {
    setBlockMode("closed");
    setBlockClosed(result);
  }, []);

  const newProjectReply = useCallback((replyIndex: number) => {
    const node = newProjectScript[newProjectStep];
    if (!node) return;
    const reply = node.replies[replyIndex];
    setNewProjectLog((log) => [
      ...log,
      { who: "bot", text: node.ask },
      { who: "user", text: reply.label, cap: reply.cap },
    ]);
    if (!reply.done) {
      setNewProjectStep((s) => s + 1);
    }
  }, [newProjectStep]);

  const acceptSchedule = useCallback(() => setScheduleConfirmed(true), []);
  const pickDifferentTimes = useCallback(() => setScheduleConfirmed(false), []);
  const togglePace = useCallback(() => {
    setSchedulePace((p) => (p === 2 ? 1 : 2));
    setScheduleConfirmed(false);
  }, []);

  const value: AppState = {
    greeting: "Afternoon, Sam",
    queue,
    later,
    kept,
    total,
    moving,
    toast,
    spending: initialSpending,

    blockMode,
    blockStep,
    blockLog,
    blockTask,
    blockClosed,

    newProjectStep,
    newProjectLog,

    schedulePace,
    scheduleConfirmed,

    markDone,
    openMove,
    cancelMove,
    executeMove,
    showToast,

    setBlockMode,
    blockReply,
    acceptBlockPlan,
    closeBlock,

    newProjectReply,

    acceptSchedule,
    pickDifferentTimes,
    togglePace,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// ─── Exported constants for components ───────────────────────

export { blockScript, blockProposalText, newProjectScript, schedulePlans, moveOptions };
