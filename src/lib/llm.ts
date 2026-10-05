import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, type ToolCall } from "./tools";
import { executeTools, type ToolResult, type RowChange } from "./tool-executor";
import { query } from "./db";

// ─── Types ───────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  rowChanges: RowChange[];
  rawResponse: unknown;
}

// ─── Client ──────────────────────────────────────────────────

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `You are lyco, a personal accountability assistant. You help the user set goals, schedule time blocks, and stay on track.

Your tone is warm but direct — like a thoughtful friend who holds you to your word. You are concise. You never use bullet points or lists. You speak in plain sentences.

When the user describes a goal or project, use the create_goal tool to save it. Collect a title, and if the user mentions a deadline or cadence, include those. If they don't mention a deadline, ask. If they don't mention cadence, ask.

When the user wants to schedule time, use schedule_block. When they finish something, use complete_block. When they want to reschedule, use move_block.

You also look after spending and dates. When the user wants a monthly limit on something (like "I want to spend less on eating out"), use create_spending_goal. When they say they bought something, use log_spending — match the spending target by name, and if nothing fits, ask which target it belongs to rather than guessing. When they mention an upcoming date worth remembering (a birthday, a trip, a deadline someone else set), use add_occasion.

Log purchases and dates without lecturing. Record what happened, confirm in one sentence, move on.

Never generate SQL. Never claim to have done something without calling the appropriate tool first. After a tool call succeeds, confirm what happened in a brief, human sentence.`;

// ─── Main entry point ────────────────────────────────────────

export async function callLLM(
  messages: ChatMessage[],
  userId: string,
  context?: string
): Promise<LLMResponse> {
  const anthropicMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let allToolCalls: ToolCall[] = [];
  let allToolResults: ToolResult[] = [];
  let allRowChanges: RowChange[] = [];
  let lastText = "";
  let rawResponse: unknown = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT,
      messages: anthropicMessages,
      tools: toolDefinitions.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    });

    rawResponse = response;

    // Extract text and tool use blocks
    const textParts: string[] = [];
    const toolUseBlocks: { id: string; name: string; input: Record<string, unknown> }[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    lastText = textParts.join("\n");

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0) {
      break;
    }

    // Execute tools
    const calls: ToolCall[] = toolUseBlocks.map((b) => ({
      name: b.name as ToolCall["name"],
      arguments: b.input,
    }));

    const execResult = await executeTools(calls, userId);
    allToolCalls.push(...calls);
    allToolResults.push(...execResult.results);
    allRowChanges.push(...execResult.rowChanges);

    // Add assistant response and tool results to the conversation
    anthropicMessages.push({
      role: "assistant" as const,
      content: response.content as unknown as string,
    });

    const toolResultContent = execResult.results.map((r, i) => ({
      type: "tool_result" as const,
      tool_use_id: toolUseBlocks[i].id,
      content: r.message,
    }));

    anthropicMessages.push({
      role: "user" as const,
      content: toolResultContent as unknown as string,
    });
  }

  return {
    text: lastText,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    rowChanges: allRowChanges,
    rawResponse,
  };
}

// ─── One-shot text generation (no tools) ─────────────────────
// Used by the schedule proposal to phrase reasoning in the app's
// voice. Callers must always have a fallback for when this throws.

export async function generateText(prompt: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system:
      "You are lyco, a personal accountability assistant. Write one or two short sentences, warm but direct, " +
      "plain sentences only — no bullet points, no lists, no exclamation marks, no scolding.",
    messages: [{ role: "user", content: prompt }],
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ─── Interaction logging ─────────────────────────────────────

export async function logInteraction(
  userId: string,
  sessionId: string | null,
  prompt: ChatMessage[],
  response: LLMResponse,
  model: string
): Promise<void> {
  await query(
    `INSERT INTO llm_interactions (user_id, session_id, prompt, model_response, tools_called, rows_changed, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      sessionId,
      JSON.stringify(prompt),
      JSON.stringify(response.rawResponse),
      JSON.stringify(response.toolCalls),
      JSON.stringify(response.rowChanges),
      model,
    ]
  );
}
