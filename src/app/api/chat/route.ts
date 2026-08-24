import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { callLLM, logInteraction, type ChatMessage } from "@/lib/llm";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const messages: ChatMessage[] = body.messages.map((m: { role: string; content: string }) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const sessionId = body.sessionId ?? null;

  try {
    const response = await callLLM(messages, user.userId);

    await logInteraction(user.userId, sessionId, messages, response, "claude-sonnet-5");

    return NextResponse.json({
      text: response.text,
      toolCalls: response.toolCalls,
      toolResults: response.toolResults,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong" },
      { status: 500 }
    );
  }
}
