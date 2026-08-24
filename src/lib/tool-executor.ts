import { query } from "./db";
import type { ToolCall } from "./tools";
import { validateToolCall } from "./tools";

// ─── Types ───────────────────────────────────────────────────

export interface ToolResult {
  tool: string;
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface RowChange {
  table: string;
  operation: "insert" | "update" | "delete";
  row_id: string;
  changes?: Record<string, unknown>;
}

export interface ExecutionResult {
  results: ToolResult[];
  rowChanges: RowChange[];
}

// ─── Executor ────────────────────────────────────────────────

export async function executeTools(
  calls: ToolCall[],
  userId: string
): Promise<ExecutionResult> {
  const results: ToolResult[] = [];
  const rowChanges: RowChange[] = [];

  for (const call of calls) {
    const validation = validateToolCall(call);
    if (!validation.ok) {
      results.push({
        tool: call.name,
        success: false,
        message: `Validation failed: ${validation.errors.join("; ")}`,
      });
      continue;
    }

    try {
      const result = await executeOne(call, userId);
      results.push(result);
      if (result.data?.rowChange) {
        rowChanges.push(result.data.rowChange as RowChange);
      }
    } catch (err) {
      results.push({
        tool: call.name,
        success: false,
        message: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { results, rowChanges };
}

// ─── Individual tool implementations ─────────────────────────

async function executeOne(call: ToolCall, userId: string): Promise<ToolResult> {
  switch (call.name) {
    case "create_goal":
      return createGoal(call.arguments, userId);
    case "update_goal":
      return updateGoal(call.arguments, userId);
    case "schedule_block":
      return scheduleBlock(call.arguments, userId);
    case "complete_block":
      return completeBlock(call.arguments, userId);
    case "move_block":
      return moveBlock(call.arguments, userId);
    default:
      return {
        tool: call.name,
        success: false,
        message: `Unknown tool: ${call.name}`,
      };
  }
}

// ─── create_goal ─────────────────────────────────────────────

async function createGoal(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const title = args.title as string;
  const deadline = args.deadline as string | undefined;
  const cadence = args.cadence as string | undefined;

  const rows = await query<{ id: string }>(
    `INSERT INTO goals (user_id, title, deadline, cadence)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, title, deadline ?? null, cadence ?? null]
  );

  const goalId = rows[0].id;
  return {
    tool: "create_goal",
    success: true,
    message: `Goal "${title}" created.`,
    data: {
      goal_id: goalId,
      rowChange: {
        table: "goals",
        operation: "insert" as const,
        row_id: goalId,
        changes: { title, deadline, cadence },
      },
    },
  };
}

// ─── update_goal ─────────────────────────────────────────────

async function updateGoal(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const goalId = args.goal_id as string;
  const updates: string[] = [];
  const params: unknown[] = [goalId, userId];
  let paramIdx = 3;

  if (args.title !== undefined) {
    updates.push(`title = $${paramIdx++}`);
    params.push(args.title);
  }
  if (args.deadline !== undefined) {
    updates.push(`deadline = $${paramIdx++}`);
    params.push(args.deadline);
  }
  if (args.cadence !== undefined) {
    updates.push(`cadence = $${paramIdx++}`);
    params.push(args.cadence);
  }
  if (args.status !== undefined) {
    updates.push(`status = $${paramIdx++}`);
    params.push(args.status);
  }

  if (updates.length === 0) {
    return {
      tool: "update_goal",
      success: false,
      message: "No fields to update.",
    };
  }

  const rows = await query<{ id: string }>(
    `UPDATE goals SET ${updates.join(", ")}
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    params
  );

  if (!rows[0]) {
    return {
      tool: "update_goal",
      success: false,
      message: "Goal not found.",
    };
  }

  return {
    tool: "update_goal",
    success: true,
    message: "Goal updated.",
    data: {
      goal_id: goalId,
      rowChange: {
        table: "goals",
        operation: "update" as const,
        row_id: goalId,
        changes: { ...args },
      },
    },
  };
}

// ─── schedule_block ──────────────────────────────────────────

async function scheduleBlock(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const title = args.title as string;
  const scheduledAt = args.scheduled_at as string;
  const durationMinutes = args.duration_minutes as number;
  const goalId = args.goal_id as string | undefined;

  const rows = await query<{ id: string }>(
    `INSERT INTO blocks (user_id, goal_id, title, scheduled_at, duration_minutes, status)
     VALUES ($1, $2, $3, $4, $5, 'scheduled')
     RETURNING id`,
    [userId, goalId ?? null, title, scheduledAt, durationMinutes]
  );

  const blockId = rows[0].id;
  return {
    tool: "schedule_block",
    success: true,
    message: `Block "${title}" scheduled for ${scheduledAt} (${durationMinutes} min).`,
    data: {
      block_id: blockId,
      rowChange: {
        table: "blocks",
        operation: "insert" as const,
        row_id: blockId,
        changes: { title, scheduled_at: scheduledAt, duration_minutes: durationMinutes, goal_id: goalId },
      },
    },
  };
}

// ─── complete_block ──────────────────────────────────────────

async function completeBlock(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const blockId = args.block_id as string;

  const rows = await query<{ id: string }>(
    `UPDATE blocks
     SET status = 'done', progress = 100
     WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'running')
     RETURNING id`,
    [blockId, userId]
  );

  if (!rows[0]) {
    return {
      tool: "complete_block",
      success: false,
      message: "Block not found or already completed.",
    };
  }

  return {
    tool: "complete_block",
    success: true,
    message: "Block marked as done.",
    data: {
      block_id: blockId,
      rowChange: {
        table: "blocks",
        operation: "update" as const,
        row_id: blockId,
        changes: { status: "done", progress: 100 },
      },
    },
  };
}

// ─── move_block ──────────────────────────────────────────────

async function moveBlock(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const blockId = args.block_id as string;
  const target = args.target as string;

  if (target === "drop") {
    const rows = await query<{ id: string }>(
      `UPDATE blocks SET status = 'dropped'
       WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'running')
       RETURNING id`,
      [blockId, userId]
    );

    if (!rows[0]) {
      return {
        tool: "move_block",
        success: false,
        message: "Block not found or already completed.",
      };
    }

    return {
      tool: "move_block",
      success: true,
      message: "Block dropped.",
      data: {
        block_id: blockId,
        rowChange: {
          table: "blocks",
          operation: "update" as const,
          row_id: blockId,
          changes: { status: "dropped" },
        },
      },
    };
  }

  // Fetch the block to get its current scheduled_at
  const blocks = await query<{ scheduled_at: Date; duration_minutes: number }>(
    `SELECT scheduled_at, duration_minutes FROM blocks
     WHERE id = $1 AND user_id = $2`,
    [blockId, userId]
  );

  if (!blocks[0]) {
    return {
      tool: "move_block",
      success: false,
      message: "Block not found.",
    };
  }

  const now = new Date();
  let newStart: Date;

  if (target === "later_today") {
    newStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 45, 0);
    if (newStart <= now) {
      newStart.setDate(newStart.getDate() + 1);
    }
  } else if (target === "tomorrow_morning") {
    newStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  } else if (target === "add_15") {
    newStart = new Date(new Date(blocks[0].scheduled_at).getTime() + 15 * 60000);
  } else {
    return {
      tool: "move_block",
      success: false,
      message: `Invalid target: ${target}`,
    };
  }

  await query(
    `UPDATE blocks SET scheduled_at = $1
     WHERE id = $2 AND user_id = $3`,
    [newStart, blockId, userId]
  );

  return {
    tool: "move_block",
    success: true,
    message: `Block moved to ${newStart.toISOString()}.`,
    data: {
      block_id: blockId,
      rowChange: {
        table: "blocks",
        operation: "update" as const,
        row_id: blockId,
        changes: { scheduled_at: newStart.toISOString() },
      },
    },
  };
}
