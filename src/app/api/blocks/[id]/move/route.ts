import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";
import { isCalendarConnected, getProvider } from "@/lib/calendar/google";
import { calendarRedirectUri } from "@/lib/app-url";

type MoveTarget = "later_today" | "tomorrow_morning" | "add_15" | "drop";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const target = body?.target as MoveTarget;

  if (!target) {
    return NextResponse.json({ error: "Missing target" }, { status: 400 });
  }

  // Fetch the block first — scoped to user_id
  const blocks = await query<{
    id: string;
    scheduled_at: Date;
    duration_minutes: number;
    calendar_event_id: string | null;
  }>(
    `SELECT id, scheduled_at, duration_minutes, calendar_event_id
     FROM blocks WHERE id = $1 AND user_id = $2`,
    [id, user.userId]
  );

  if (!blocks[0]) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }

  const block = blocks[0];
  const now = new Date();

  // Google Calendar sync — best effort; a failure never blocks the move
  const provider =
    block.calendar_event_id && (await isCalendarConnected(user.userId))
      ? await getProvider(user.userId, calendarRedirectUri())
      : null;

  if (target === "drop") {
    await query(
      `UPDATE blocks SET status = 'dropped' WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    );
    if (provider && block.calendar_event_id) {
      try {
        await provider.deleteEvent(block.calendar_event_id);
      } catch (err) {
        console.error(`Failed to delete calendar event ${block.calendar_event_id}:`, err);
      }
    }
    return NextResponse.json({ ok: true, message: "dropped. it will not come back on its own." });
  }

  if (target === "add_15") {
    // Extend the block so it ends 15 minutes later, rather than
    // pushing the start into the future.
    const newDuration = block.duration_minutes + 15;
    const newEnd = new Date(new Date(block.scheduled_at).getTime() + newDuration * 60000);

    await query(
      `UPDATE blocks SET duration_minutes = $1 WHERE id = $2 AND user_id = $3`,
      [newDuration, id, user.userId]
    );

    if (provider && block.calendar_event_id) {
      try {
        await provider.updateEvent(block.calendar_event_id, { end: newEnd.toISOString() });
      } catch (err) {
        console.error(`Failed to update calendar event ${block.calendar_event_id}:`, err);
      }
    }

    return NextResponse.json({ ok: true, message: `15 minutes added. until ${formatTime(newEnd)}.` });
  }

  let newStart: Date;

  if (target === "later_today") {
    newStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 45, 0);
    if (newStart <= now) {
      newStart.setDate(newStart.getDate() + 1);
    }
  } else if (target === "tomorrow_morning") {
    newStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  } else {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  const newEnd = new Date(newStart.getTime() + block.duration_minutes * 60000);

  await query(
    `UPDATE blocks SET scheduled_at = $1 WHERE id = $2 AND user_id = $3`,
    [newStart, id, user.userId]
  );

  if (provider && block.calendar_event_id) {
    try {
      await provider.updateEvent(block.calendar_event_id, {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });
    } catch (err) {
      console.error(`Failed to update calendar event ${block.calendar_event_id}:`, err);
    }
  }

  const messages: Record<string, string> = {
    later_today: `moved to ${formatTime(newStart)}. calendar updated.`,
    tomorrow_morning: `moved to tomorrow, ${formatTime(newStart)}.`,
  };

  return NextResponse.json({ ok: true, message: messages[target] });
}

function formatTime(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}
