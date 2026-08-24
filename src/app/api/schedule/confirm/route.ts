import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";
import { isCalendarConnected, getProvider } from "@/lib/calendar/google";

interface SlotInput {
  day: string;
  time: string;
  durationMinutes: number;
  title: string;
}

interface ConfirmBody {
  goalId?: string;
  goalTitle: string;
  slots: SlotInput[];
}

// Parse a slot like { day: "Tuesday", time: "7:00 – 8:30 pm" } into
// concrete start/end datetimes for the next occurrence of that weekday.
function parseSlotToDates(slot: SlotInput, now: Date): { start: Date; end: Date } | null {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  const dayName = slot.day.toLowerCase().trim();
  const targetDay = dayMap[dayName];
  if (targetDay === undefined) return null;

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

  // Find next occurrence of the target weekday
  const result = new Date(now);
  const currentDay = result.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0) {
    // Today — check if the time hasn't passed yet
    const todayStart = new Date(result);
    todayStart.setHours(startHour, startMin, 0, 0);
    if (todayStart <= now) daysUntil = 7;
  }
  result.setDate(result.getDate() + daysUntil);
  result.setHours(startHour, startMin, 0, 0);

  const end = new Date(result);
  end.setHours(endHour, endMin, 0, 0);

  return { start: result, end };
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

  const now = new Date();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001";
  const redirectUri = `${baseUrl}/api/calendar/callback`;

  const calendarConnected = await isCalendarConnected(user.userId);
  const provider = calendarConnected ? await getProvider(user.userId, redirectUri) : null;

  const createdBlocks: { id: string; title: string; scheduledAt: string; calendarEventId?: string }[] = [];
  const errors: string[] = [];

  for (const slot of body.slots) {
    const dates = parseSlotToDates(slot, now);
    if (!dates) {
      errors.push(`Could not parse slot: ${slot.day} ${slot.time}`);
      continue;
    }

    // Insert block into DB
    const rows = await query<{ id: string }>(
      `INSERT INTO blocks (user_id, goal_id, title, scheduled_at, duration_minutes, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [user.userId, body.goalId ?? null, slot.title, dates.start, slot.durationMinutes]
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

        // Store the calendar event ID on the block (in a future column or separate table)
        // For now, we log it
        console.log(`Calendar event created: ${event.htmlLink} for block ${blockId}`);
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
