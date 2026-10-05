import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "title is required and must be a non-empty string" }, { status: 400 });
  }

  const rows = await query<{ id: string }>(
    `UPDATE blocks SET title = $1
     WHERE id = $2 AND user_id = $3 AND status IN ('scheduled', 'running')
     RETURNING id`,
    [title, id, user.userId]
  );

  if (!rows[0]) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
