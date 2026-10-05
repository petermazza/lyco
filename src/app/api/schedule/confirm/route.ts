import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";
import { isCalendarConnected, getProvider } from "@/lib/calendar/google";
import { calendarRedirectUri } from "@/lib/app-url";
import { resolveTimezone, nextWeekdayTime } from "@/lib/tz";

interface SlotInput {
  // Preferred: concrete ISO 8601 start. Legacy fallback: "Tuesday" + "7:00 – 8:30 pm".
  start?: string;
  day?: string;
  time?: string;
  durationMinutes: number;
  title: string;
}

interface ConfirmBody {
  goalId?: string;
  goalTitle: string;
  slots: SlotInput[];
}

// Parse a slot like { day: "Tuesday", time: "7:00 – 8:30 pm" } into
// concrete start/end datetimes for the next occurrence of that weekday
// in the user's timezone.
function parseSlotToDates(tz: string, slot: SlotInput, now: Date): { start: Date; end: Date } | null {
  if (slot.start) {
    const start = new Date(slot.start);
    if (isNaN(start.getTime())) return null;
    return { start, end: new Date(start.getTime() + slot.durationMinutes * 60000) };
  }

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  const dayName = (slot.day ?? "").toLowerCase().trim();
  const targetDay = dayMap[dayName];
  if (targetDay === undefined || !slot.time) return null;

  // Parse time string like "7:00 – 8:30 pm" or "9:30 – 11:00 am"
  const timeMatch = slot.time.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!timeMatch) return null;

  const [, startH, startM, endH, endM, period] = timeMatch;
  let startHour = parseInt(startH, 10);
  const startMin = parseInt(startM, 10);
  let endHour = parseInt(endH, 10);
  const endMin = parseInt(endM, 10);
  const isPM = period.toLowerCase() === "pm";

  // Convert to 24h
  if (isPM && startHour !== 12) startHour += 12;
  if (!isPM && startHour === 12) startHour = 0;
  if (isPM && endHour !== 12) endHour += 12;
  if (!isPM && endHour === 12) endHour = 0;

  // Find next occurrence of the target weekday + wall-clock time in the user's zone
  const start = nextWeekdayTime(tz, now, targetDay, startHour, startMin);
  const end = new Date(nextWeekdayTime(tz, now, targetDay, endHour, endMin).getTime());
  // If the end isn't after the start (e.g. range crosses midnight), fall back to duration
  if (end <= start) {
    end.setTime(start.getTime() + (slot.durationMinutes ?? 90) * 60000);
  }

  return { start, end };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as ConfirmBody | null;
  if (!body?.goalTitle || !body?.slots?.length) {
    return NextResponse.json({ error: "goalTitle and slots are required" }, { status: 400 });
  }

  // If a goalId was provided, verify it belongs to this user
  if (body.goalId) {
    const goals = await query<{ id: string }>(
      `SELECT id FROM goals WHERE id = $1 AND user_id = $2`,
      [body.goalId, user.userId]
    );
    if (!goals[0]) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }
  }

  const now = new Date();
  const tz = resolveTimezone(user.timezone);
  const calendarConnected = await isCalendarConnected(user.userId);
  const provider = calendarConnected ? await getProvider(user.userId, calendarRedirectUri()) : null;

  const createdBlocks: { id: string; title: string; scheduledAt: string; calendarEventId?: string }[] = [];
  const errors: string[] = [];

  for (const slot of body.slots) {
    const duration = typeof slot.durationMinutes === "number" && slot.durationMinutes > 0
      ? Math.min(slot.durationMinutes, 480)
      : 90;

    const dates = parseSlotToDates(tz, { ...slot, durationMinutes: duration }, now);
    if (!dates) {
      errors.push(`Could not parse slot: ${slot.day ?? ""} ${slot.time ?? slot.start ?? ""}`.trim());
      continue;
    }

    // Insert block into DB
    const rows = await query<{ id: string }>(
      `INSERT INTO blocks (user_id, goal_id, title, scheduled_at, duration_minutes, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [user.userId, body.goalId ?? null, slot.title, dates.start, duration]
    );
    const blockId = rows[0].id;

    let calendarEventId: string | undefined;

    // Write to Google Calendar if connected
    if (provider) {
      try {
        const event = await provider.createEvent({
          summary: slot.title,
          description: `Goal: ${body.goalTitle}`,
          start: dates.start.toISOString(),
          end: dates.end.toISOString(),
        });
        calendarEventId = event.id;

        await query(
          `UPDATE blocks SET calendar_event_id = $1 WHERE id = $2`,
          [event.id, blockId]
        );
      } catch (err) {
        console.error(`Failed to create calendar event for block ${blockId}:`, err);
        errors.push(`Calendar event failed for "${slot.title}"`);
      }
    }

    createdBlocks.push({
      id: blockId,
      title: slot.title,
      scheduledAt: dates.start.toISOString(),
      calendarEventId,
    });
  }

  return NextResponse.json({
    success: true,
    blocks: createdBlocks,
    calendarConnected,
    errors: errors.length > 0 ? errors : undefined,
  });
}
