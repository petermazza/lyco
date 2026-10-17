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
  // are read once and never stored. replyTo carries the quoted sentence
  // or paragraph the user is replying to, if any.
  const MAX_REPLY_TO_LENGTH = 2000;
  let attachmentError: string | null = null;
  const malformed = body.messages.some((m: unknown) => {
    if (!m || typeof m !== "object") return true;
    const msg = m as { content?: unknown; attachments?: unknown; replyTo?: unknown };
    const hasText = typeof msg.content === "string" && msg.content.trim().length > 0;
    if (msg.content !== undefined && typeof msg.content !== "string") return true;
    if (msg.replyTo !== undefined) {
      if (
        typeof msg.replyTo !== "string" ||
        msg.replyTo.trim().length === 0 ||
        msg.replyTo.length > MAX_REPLY_TO_LENGTH
      ) {
        attachmentError = `replyTo must be a non-empty string up to ${MAX_REPLY_TO_LENGTH} characters`;
        return true;
      }
    }

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
    (m: { role: string; content?: string; attachments?: unknown[]; replyTo?: string }) => {
      const attachments: ChatAttachment[] | undefined = m.attachments?.length
        ? m.attachments.map((a) => {
            const check = validateAttachment(a);
            return check.ok ? check.value : (a as ChatAttachment);
          })
        : undefined;
      const replyPrefix =
        typeof m.replyTo === "string" && m.replyTo.trim()
          ? `[Replying to: "${m.replyTo.trim()}"]\n`
          : "";
      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content:
          replyPrefix +
          (typeof m.content === "string" && m.content.trim() ? m.content : "See attached."),
        attachments,
      };
    }
  );

  const sessionId = body.sessionId ?? null;
  const context = typeof body.context === "string" ? body.context : undefined;

  // Optional side chat: `mainMessages` carries the ongoing conversation as
  // read-only background so a side question never has to derail it.
  if (body.mainMessages !== undefined) {
    const badMain =
      !Array.isArray(body.mainMessages) ||
      body.mainMessages.some((m: unknown) => {
        if (!m || typeof m !== "object") return true;
        const msg = m as { content?: unknown; attachments?: unknown; replyTo?: unknown };
        if (msg.content !== undefined && typeof msg.content !== "string") return true;
        if (msg.replyTo !== undefined && typeof msg.replyTo !== "string") return true;
        const hasText = typeof msg.content === "string" && msg.content.trim().length > 0;
        const hasAtts = Array.isArray(msg.attachments) && msg.attachments.length > 0;
        return !hasText && !hasAtts;
      });
    if (badMain) {
      return NextResponse.json(
        { error: "mainMessages must be an array of valid messages" },
        { status: 400 }
      );
    }
  }

  const sideChat = body.sideChat === true;
  const mainMessages: ChatMessage[] = Array.isArray(body.mainMessages)
    ? body.mainMessages.map(
        (m: { role: string; content?: string; attachments?: { name?: string }[]; replyTo?: string }) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content:
            (typeof m.replyTo === "string" && m.replyTo.trim()
              ? `[Replying to: "${m.replyTo.trim()}"] `
              : "") +
            (typeof m.content === "string" && m.content.trim() ? m.content : "See attached.") +
            (Array.isArray(m.attachments) && m.attachments.length
              ? ` [attached: ${m.attachments.map((a) => a?.name ?? "file").join(", ")}]`
              : ""),
        })
      )
    : [];

  const sideContext = sideChat
    ? [
        mainMessages.length > 0
          ? "Main conversation so far:\n" +
            mainMessages
              .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
              .join("\n")
          : "",
        "The user opened a side chat to ask a question or handle an aside without interrupting the main conversation above. " +
          "Answer their side chat message directly and concisely using the main conversation as background context. " +
          "Do not ask follow-up questions about unfinished details from the main conversation (such as missing deadlines or cadence) unless the user explicitly asks you to save a goal right now. " +
          "If they explicitly ask to save a goal, log spending, add a date, or update a block in this side chat, call the appropriate tool as usual.",
      ]
        .filter(Boolean)
        .join("\n\n")
    : undefined;

  const fullContext = [context, sideContext].filter(Boolean).join("\n\n") || undefined;

  try {
    const response = await callLLM(messages, user.userId, fullContext, user.preferredModel ?? undefined);

    await logInteraction(user.userId, sessionId ?? (sideChat ? "side" : null), messages, response, response.model);

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
