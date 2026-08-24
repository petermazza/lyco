import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Mark the block as done — scoped to user_id
  const rows = await query<{ id: string }>(
    `UPDATE blocks SET status = 'done' WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'running') RETURNING id`,
    [id, user.userId]
  );

  if (!rows[0]) {
    return NextResponse.json({ error: "Block not found or already completed" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
