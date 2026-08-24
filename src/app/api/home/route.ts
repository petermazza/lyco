import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";

// ─── Helpers ─────────────────────────────────────────────────

function formatTime(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatDateLabel(date: Date): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayNum = date.getDate();
  const time = formatTime(date);
  return `${dayName} ${dayNum} ${monthName} · ${time}`;
}

function greetingFor(date: Date, name: string | null): string {
  const h = date.getHours();
  const part = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  return `${part}, ${name ?? "there"}`;
}

function formatDuration(minutes: number): string {
  return `${minutes} minutes`;
}

function formatDurationShort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ─── Types ───────────────────────────────────────────────────

interface HomeResponse {
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

// ─── Route ───────────────────────────────────────────────────

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const userId = user.userId;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // ─── Current block + later today ───────────────────────────
  const blocks = await query<{
    id: string;
    title: string;
    scheduled_at: Date;
    duration_minutes: number;
    status: string;
    progress: number;
  }>(
    `SELECT id, title, scheduled_at, duration_minutes, status, progress
     FROM blocks
     WHERE user_id = $1
       AND scheduled_at >= $2 AND scheduled_at < $3
       AND status IN ('scheduled', 'running')
     ORDER BY scheduled_at`,
    [userId, todayStart, todayEnd]
  );

  let currentBlock: HomeResponse["currentBlock"] = null;
  const laterToday: HomeResponse["laterToday"] = [];

  for (const b of blocks) {
    const start = new Date(b.scheduled_at);
    const end = new Date(start.getTime() + b.duration_minutes * 60000);

    if (!currentBlock && (b.status === "running" || (start <= now && end > now))) {
      const elapsedMin = Math.floor((now.getTime() - start.getTime()) / 60000);
      const leftMin = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 60000));
      currentBlock = {
        id: b.id,
        title: b.title,
        meta: `${formatDuration(b.duration_minutes)} · until ${formatTime(end)} · calendar`,
        progress: `${b.progress}%`,
        elapsed: elapsedMin > 0 ? `${elapsedMin} minutes in` : "just started",
        left: `${leftMin} minutes left`,
      };
    } else if (start > now) {
      laterToday.push({
        time: formatTime(start),
        title: b.title,
        len: formatDurationShort(b.duration_minutes),
      });
    }
  }

  // ─── Spending goals + entries this month ───────────────────
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const spendingGoals = await query<{
    id: string;
    label: string;
    budget_cents: number;
  }>(
    `SELECT id, label, budget_cents FROM spending_goals WHERE user_id = $1`,
    [userId]
  );

  const spending: HomeResponse["spending"] = [];

  for (const sg of spendingGoals) {
    const entries = await query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM spending_entries
       WHERE user_id = $1 AND spending_goal_id = $2
         AND spent_at >= $3 AND spent_at < $4`,
      [userId, sg.id, monthStart, monthEnd]
    );

    const spentCents = parseInt(entries[0]?.total ?? "0", 10);
    const budgetCents = sg.budget_cents;
    const spentDollars = (spentCents / 100).toFixed(0);
    const budgetDollars = (budgetCents / 100).toFixed(0);
    const ratio = budgetCents > 0 ? spentCents / budgetCents : 0;
    const barWidth = `${Math.min(100, ratio * 100).toFixed(1)}%`;
    const overBudget = spentCents > budgetCents;
    const barColor = overBudget ? "var(--color-neutral-500)" : "var(--color-accent-500)";

    // Expected pace: day-of-month / days-in-month
    const dayOfMonth = now.getDate();
    const totalDays = daysInMonth(now);
    const expectedPace = dayOfMonth / totalDays;
    const markerLeft = `${(expectedPace * 100).toFixed(0)}%`;

    const daysLeft = totalDays - dayOfMonth;
    let note: string;
    if (overBudget) {
      const over = ((spentCents - budgetCents) / 100).toFixed(0);
      note = `$${over} past the target you set · noted, nothing to do`;
    } else if (ratio <= expectedPace * 1.1) {
      note = `about level with the month · ${daysLeft} days left`;
    } else {
      note = `ahead of pace · ${daysLeft} days left`;
    }

    spending.push({
      label: sg.label,
      figure: `$${spentDollars} of $${budgetDollars}`,
      barWidth,
      barColor,
      note,
      markerLeft,
    });
  }

  // ─── Upcoming occasions ────────────────────────────────────
  const occasions = await query<{
    id: string;
    title: string;
    date: string;
    note: string | null;
  }>(
    `SELECT id, title, date, note FROM occasions
     WHERE user_id = $1 AND date >= CURRENT_DATE
     ORDER BY date LIMIT 5`,
    [userId]
  );

  const upcoming = occasions.map((o) => {
    const occasionDate = typeof o.date === "string" ? new Date(o.date + "T00:00:00") : new Date(o.date);
    occasionDate.setHours(0, 0, 0, 0);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysAway = Math.round((occasionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { id: o.id, title: o.title, daysAway, note: o.note };
  });

  // ─── Kept-blocks ratio this month ──────────────────────────
  const ratio = await query<{ kept: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'done') AS kept,
       COUNT(*) AS total
     FROM blocks
     WHERE user_id = $1
       AND scheduled_at >= $2 AND scheduled_at < $3`,
    [userId, monthStart, monthEnd]
  );

  const kept = parseInt(ratio[0]?.kept ?? "0", 10);
  const total = parseInt(ratio[0]?.total ?? "0", 10);

  const response: HomeResponse = {
    greeting: greetingFor(now, user.name),
    dateLabel: formatDateLabel(now),
    currentBlock,
    laterToday,
    spending,
    upcoming,
    kept,
    total,
  };

  return NextResponse.json(response);
}
