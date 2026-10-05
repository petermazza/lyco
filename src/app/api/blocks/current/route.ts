import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";

// Returns the block the user is in right now: a running block, or a
// scheduled block whose time window contains now. Read-only — the home
// screen already treats an in-window scheduled block as current.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query<{
    id: string;
    title: string;
    scheduled_at: Date;
    duration_minutes: number;
    status: string;
    progress: number;
    goal_title: string | null;
  }>(
    `SELECT b.id, b.title, b.scheduled_at, b.duration_minutes, b.status, b.progress,
            g.title AS goal_title
     FROM blocks b
     LEFT JOIN goals g ON g.id = b.goal_id
     WHERE b.user_id = $1
       AND (
         b.status = 'running'
         OR (b.status = 'scheduled'
             AND b.scheduled_at <= $2
             AND b.scheduled_at + (b.duration_minutes || ' minutes')::interval > $2)
       )
     ORDER BY (b.status = 'running') DESC, b.scheduled_at
     LIMIT 1`,
    [user.userId, new Date()]
  );

  const b = rows[0];
  if (!b) {
    return NextResponse.json({ block: null });
  }

  return NextResponse.json({
    block: {
      id: b.id,
      title: b.title,
      goalTitle: b.goal_title,
      scheduledAt: new Date(b.scheduled_at).toISOString(),
      durationMinutes: b.duration_minutes,
      status: b.status,
      progress: b.progress,
    },
  });
}
