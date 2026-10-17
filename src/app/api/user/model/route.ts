import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";
import { CHAT_MODELS, DEFAULT_MODEL, isChatModel } from "@/lib/llm";

// The user's model preference for conversations. GET returns the
// current pick plus the full lineup for the picker. POST stores a
// choice; a model outside the lineup is rejected.

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    model: isChatModel(user.preferredModel) ? user.preferredModel : DEFAULT_MODEL,
    models: CHAT_MODELS,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const model = body?.model;

  // "default" clears the stored preference and returns to the app default.
  if (model === "default" || model === null) {
    await query(`UPDATE users SET preferred_model = NULL WHERE id = $1`, [user.userId]);
    return NextResponse.json({ ok: true, model: DEFAULT_MODEL });
  }

  if (!isChatModel(model)) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }

  await query(`UPDATE users SET preferred_model = $1 WHERE id = $2`, [model, user.userId]);
  return NextResponse.json({ ok: true, model });
}
