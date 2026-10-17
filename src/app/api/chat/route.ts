import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { callLLM, logInteraction, type ChatMessage } from "@/lib/llm";
import { MAX_ATTACHMENTS, validateAttachment, type ChatAttachment } from "@/lib/attachments";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  // A message is valid with either text or attachments — attachments
  // are read once and never stored.
  let attachmentError: string | null = null;
  const malformed = body.messages.some((m: unknown) => {
    if (!m || typeof m !== "object") return true;
    const msg = m as { content?: unknown; attachments?: unknown };
    const hasText = typeof msg.content === "string" && msg.content.trim().length > 0;
    if (msg.content !== undefined && typeof msg.content !== "string") return true;

    let atts: unknown[] = [];
    if (msg.attachments !== undefined) {
      if (!Array.isArray(msg.attachments) || msg.attachments.length > MAX_ATTACHMENTS) {
        attachmentError = `Each message can carry up to ${MAX_ATTACHMENTS} attachments`;
        return true;
      }
      atts = msg.attachments;
      for (const att of atts) {
        const check = validateAttachment(att);
        if (!check.ok) {
          attachmentError = check.error;
          return true;
        }
      }
    }
    if (!hasText && atts.length === 0) {
      attachmentError = "Each message must have text or an attachment";
      return true;
    }
    return false;
  });
  if (malformed) {
    return NextResponse.json(
      { error: attachmentError ?? "Each message must have text or an attachment" },
      { status: 400 }
    );
  }

  const messages: ChatMessage[] = body.messages.map(
    (m: { role: string; content?: string; attachments?: unknown[] }) => {
      const attachments: ChatAttachment[] | undefined = m.attachments?.length
        ? m.attachments.map((a) => {
            const check = validateAttachment(a);
            return check.ok ? check.value : (a as ChatAttachment);
          })
        : undefined;
      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" && m.content.trim() ? m.content : "See attached.",
        attachments,
      };
    }
  );

  const sessionId = body.sessionId ?? null;
  const context = typeof body.context === "string" ? body.context : undefined;

  try {
    const response = await callLLM(messages, user.userId, context, user.preferredModel ?? undefined);

    await logInteraction(user.userId, sessionId, messages, response, response.model);

    return NextResponse.json({
      text: response.text,
      toolCalls: response.toolCalls,
      toolResults: response.toolResults,
      model: response.model,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong" },
      { status: 500 }
    );
  }
}
