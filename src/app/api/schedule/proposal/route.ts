import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";
import { isCalendarConnected, getProvider } from "@/lib/calendar/google";
import { calendarRedirectUri } from "@/lib/app-url";
import { generateText } from "@/lib/llm";

// ─── Candidate windows ───────────────────────────────────────
// Recurring weekly slots to consider: weekday evenings, weekend
// mornings and early afternoons. 90-minute blocks by default.

const BLOCK_MINUTES = 90;
const WEEKDAY_WINDOWS = [[18, 30], [19, 0], [19, 30], [20, 0]];
const WEEKEND_WINDOWS = [[9, 0], [9, 30], [10, 0], [10, 30], [14, 0]];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HISTORY_OCCURRENCES = 10;
const FUTURE_WEEKS = 4;

interface BusyInterval {
  start: Date;
  end: Date;
}

function overlaps(start: Date, end: Date, busy: BusyInterval[]): boolean {
  return busy.some((b) => start < b.end && end > b.start);
}

function occurrencesOf(weekday: number, hour: number, minute: number, from: Date, count: number, backwards: boolean): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const cursor = new Date(from);
  cursor.setHours(hour, minute, 0, 0);

  // Move to the nearest matching weekday
  while (cursor.getDay() !== weekday) {
    cursor.setDate(cursor.getDate() + (backwards ? -1 : 1));
  }
  if (backwards ? cursor >= from : cursor <= from) {
    cursor.setDate(cursor.getDate() + (backwards ? -7 : 7));
  }

  for (let i = 0; i < count; i++) {
    out.push({
      start: new Date(cursor),
      end: new Date(cursor.getTime() + BLOCK_MINUTES * 60000),
    });
    cursor.setDate(cursor.getDate() + (backwards ? -7 : 7));
  }
  return out;
}

function formatTime(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function timeOfDay(hour: number): string {
  if (hour < 12) return "mornings";
  if (hour < 17) return "afternoons";
  return "evenings";
}

function cadenceToPerWeek(cadence: string | null): number {
  if (!cadence) return 2;
  const n = cadence.match(/(\d+)/);
  if (n) return Math.min(5, Math.max(1, parseInt(n[1], 10)));
  if (/weekday|daily|every day/i.test(cadence)) return 5;
  if (/twice|two/i.test(cadence)) return 2;
  return 1;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const goalId = req.nextUrl.searchParams.get("goalId");
  const perWeekParam = parseInt(req.nextUrl.searchParams.get("perWeek") ?? "", 10);
  const variant = Math.max(0, parseInt(req.nextUrl.searchParams.get("variant") ?? "0", 10) || 0);

  // goalId optional — without it, propose for the most recent active goal
  const goals = await query<{
    id: string;
    title: string;
    // pg returns DATE columns as Date objects, not strings
    deadline: string | Date | null;
    cadence: string | null;
    status: string;
  }>(
    goalId
      ? `SELECT id, title, deadline, cadence, status FROM goals WHERE id = $1 AND user_id = $2`
      : `SELECT id, title, deadline, cadence, status FROM goals WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    goalId ? [goalId, user.userId] : [user.userId]
  );

  const goal = goals[0];
  if (!goal || goal.status !== "active") {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  const now = new Date();
  const perWeek = perWeekParam >= 1 && perWeekParam <= 5 ? perWeekParam : cadenceToPerWeek(goal.cadence);

  // ─── Busy intervals: Google free/busy + this app's blocks ──
  const pastStart = new Date(now.getTime() - (HISTORY_OCCURRENCES + 1) * 7 * 86400000);
  const futureEnd = new Date(now.getTime() + FUTURE_WEEKS * 7 * 86400000);

  const busy: BusyInterval[] = [];
  const calendarConnected = await isCalendarConnected(user.userId);

  if (calendarConnected) {
    try {
      const provider = await getProvider(user.userId, calendarRedirectUri());
      const fb = await provider.getFreeBusy(pastStart.toISOString(), futureEnd.toISOString());
      for (const slot of fb.busy) {
        busy.push({ start: new Date(slot.start), end: new Date(slot.end) });
      }
    } catch (err) {
      console.error("Free/busy lookup failed, using local blocks only:", err);
    }
  }

  const localBlocks = await query<{ scheduled_at: Date; duration_minutes: number }>(
    `SELECT scheduled_at, duration_minutes FROM blocks
     WHERE user_id = $1 AND status != 'dropped'
       AND scheduled_at >= $2 AND scheduled_at < $3`,
    [user.userId, pastStart, futureEnd]
  );
  for (const b of localBlocks) {
    const start = new Date(b.scheduled_at);
    busy.push({ start, end: new Date(start.getTime() + b.duration_minutes * 60000) });
  }

  // ─── Score every candidate recurring slot ──────────────────
  interface Candidate {
    weekday: number;
    hour: number;
    minute: number;
    histFree: number;
    histTotal: number;
    futureFree: number;
  }

  const candidates: Candidate[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const windows = weekday === 0 || weekday === 6 ? WEEKEND_WINDOWS : WEEKDAY_WINDOWS;
    for (const [hour, minute] of windows) {
      const past = occurrencesOf(weekday, hour, minute, now, HISTORY_OCCURRENCES, true);
      const future = occurrencesOf(weekday, hour, minute, now, FUTURE_WEEKS, false);
      const histFree = past.filter((o) => !overlaps(o.start, o.end, busy)).length;
      const futureFree = future.filter((o) => !overlaps(o.start, o.end, busy)).length;
      candidates.push({ weekday, hour, minute, histFree, histTotal: past.length, futureFree });
    }
  }

  candidates.sort((a, b) =>
    b.histFree / b.histTotal - a.histFree / a.histTotal ||
    b.futureFree - a.futureFree ||
    a.weekday - b.weekday ||
    a.hour - b.hour
  );

  // Rotate by variant so "pick different times" surfaces other slots
  const rotated = [...candidates.slice(variant), ...candidates.slice(0, variant)];
  const chosen: Candidate[] = [];
  const usedDays = new Set<number>();
  for (const c of rotated) {
    if (chosen.length >= perWeek) break;
    if (c.futureFree === 0) continue;
    if (usedDays.has(c.weekday)) continue;
    usedDays.add(c.weekday);
    chosen.push(c);
  }

  // ─── Shape the slots ───────────────────────────────────────
  const slots = chosen.map((c) => {
    const next = occurrencesOf(c.weekday, c.hour, c.minute, now, 1, false)[0];
    const end = new Date(next.start.getTime() + BLOCK_MINUTES * 60000);
    const tod = timeOfDay(c.hour);
    const history = calendarConnected
      ? c.histFree === c.histTotal
        ? `free on all of the last ${c.histTotal} ${DAY_NAMES[c.weekday]} ${tod}`
        : `free on ${c.histFree} of the last ${c.histTotal} ${DAY_NAMES[c.weekday]} ${tod}`
      : "checked against your scheduled blocks only";

    return {
      weekday: c.weekday,
      day: DAY_NAMES[c.weekday],
      start: next.start.toISOString(),
      time: `${formatTime(next.start)} – ${formatTime(end)}`,
      durationMinutes: BLOCK_MINUTES,
      history,
    };
  });

  // ─── Deadline + session math ───────────────────────────────
  const deadlineDate = goal.deadline
    ? goal.deadline instanceof Date
      ? goal.deadline
      : new Date(goal.deadline + "T00:00:00")
    : null;

  let weeksLeft: number | null = null;
  let deadlineLabel: string | null = null;
  let deadlineISO: string | null = null;
  if (deadlineDate) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    weeksLeft = Math.max(0, Math.ceil((deadlineDate.getTime() - today.getTime()) / (7 * 86400000)));
    deadlineLabel = deadlineDate.toLocaleDateString("en-US", { day: "numeric", month: "long" });
    deadlineISO = `${deadlineDate.getFullYear()}-${String(deadlineDate.getMonth() + 1).padStart(2, "0")}-${String(deadlineDate.getDate()).padStart(2, "0")}`;
  }

  const totalSessions = weeksLeft !== null ? perWeek * weeksLeft : perWeek;
  const sessionsText = deadlineLabel
    ? `that is ${totalSessions} sessions before ${deadlineLabel}.`
    : `that is ${perWeek} ${perWeek === 1 ? "session" : "sessions"} each week, open-ended.`;

  // ─── Reasoning sentence (AI phrasing, deterministic fallback) ─
  const slotDesc = slots.map((s) => `${s.day} ${s.time}`).join("; ") || "no clear slots";
  const fallbackReasoning =
    perWeek === 1
      ? "Once a week still lands it, with less slack near the end."
      : `${perWeek === 2 ? "Twice" : `${perWeek} times`} a week gets you there with room to spare.`;

  let reasoning = fallbackReasoning;
  try {
    const text = await generateText(
      `Goal: "${goal.title}". ${deadlineLabel ? `Deadline: ${deadlineLabel} (${weeksLeft} weeks left).` : "No deadline."} ` +
      `Proposed pace: ${perWeek} time${perWeek === 1 ? "" : "s"} a week — ${slotDesc}. ` +
      `Write one sentence explaining why this pace works for the deadline.`
    );
    if (text) reasoning = text;
  } catch (err) {
    console.error("Reasoning generation failed, using fallback:", err);
  }

  return NextResponse.json({
    goal: { id: goal.id, title: goal.title, deadline: deadlineISO, weeksLeft },
    reasoning,
    sessions: sessionsText,
    calendarConnected,
    slots,
  });
}
