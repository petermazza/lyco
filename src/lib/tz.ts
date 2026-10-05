// ─── User-timezone date math ─────────────────────────────────
// All "today", "this evening", "9 am tomorrow" math goes through
// these helpers so every part of the app agrees on whose clock
// we're using. Falls back to the server's local zone.

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const partsFormatter = (tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function zonedParts(tz: string, date: Date): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    map[p.type] = p.value;
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10) % 24,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

// How far ahead of UTC the zone is at `date`, in ms.
function tzOffsetMs(tz: string, date: Date): number {
  const p = zonedParts(tz, date);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

// Interpret wall-clock y/mo/d/h/mi in `tz` as a UTC instant.
export function zonedToUTC(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off1 = tzOffsetMs(tz, guess);
  const off2 = tzOffsetMs(tz, new Date(guess.getTime() - off1));
  return new Date(guess.getTime() - off2);
}

// Start and end of the current calendar day in `tz`.
export function todayBounds(tz: string, now: Date): { start: Date; end: Date } {
  const p = zonedParts(tz, now);
  const start = zonedToUTC(tz, p.year, p.month, p.day, 0, 0);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const np = { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
  const end = zonedToUTC(tz, np.y, np.m, np.d, 0, 0);
  return { start, end };
}

// Start of the current month and start of the next, in `tz`.
export function monthBounds(tz: string, now: Date): { start: Date; end: Date } {
  const p = zonedParts(tz, now);
  const start = zonedToUTC(tz, p.year, p.month, 1, 0, 0);
  const next = p.month === 12 ? { y: p.year + 1, m: 1 } : { y: p.year, m: p.month + 1 };
  const end = zonedToUTC(tz, next.y, next.m, 1, 0, 0);
  return { start, end };
}

// A wall-clock time today or in the future in `tz` (e.g. 18:45 for "later today").
export function nextLocalTime(tz: string, now: Date, hour: number, minute: number): Date {
  const p = zonedParts(tz, now);
  let t = zonedToUTC(tz, p.year, p.month, p.day, hour, minute);
  if (t <= now) {
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    t = zonedToUTC(tz, tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, minute);
  }
  return t;
}

// A wall-clock time tomorrow in `tz` (e.g. 9:00 for "tomorrow morning").
export function tomorrowLocalTime(tz: string, now: Date, hour: number, minute: number): Date {
  const p = zonedParts(tz, now);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedToUTC(tz, tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, minute);
}

// Next occurrence of a weekday + wall-clock time in `tz`, strictly after `now`.
export function nextWeekdayTime(tz: string, now: Date, weekday: number, hour: number, minute: number): Date {
  const p = zonedParts(tz, now);
  // Walk forward from today's date until we hit the weekday and a future time
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const t = zonedToUTC(tz, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute);
    if (zonedParts(tz, t).weekday === weekday && t > now) return t;
  }
  // Should never reach — one of 8 days matches the weekday
  return zonedToUTC(tz, p.year, p.month, p.day + 7, hour, minute);
}

export function formatTimeTz(tz: string, date: Date): string {
  const p = zonedParts(tz, date);
  const ampm = p.hour >= 12 ? "pm" : "am";
  const h = p.hour % 12 || 12;
  return `${h}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}

export function formatDateLabelTz(tz: string, date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const p = zonedParts(tz, date);
  return `${days[p.weekday]} ${p.day} ${months[p.month - 1]} · ${formatTimeTz(tz, date)}`;
}

export function greetingForTz(tz: string, now: Date, name: string | null): string {
  const h = zonedParts(tz, now).hour;
  const part = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  return `${part}, ${name ?? "there"}`;
}

export function daysInMonthTz(tz: string, now: Date): number {
  const p = zonedParts(tz, now);
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}
