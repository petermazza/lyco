import { query } from "./db";
import { resolveTimezone, nextLocalTime, tomorrowLocalTime } from "./tz";
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
    case "update_block":
      return updateBlock(call.arguments, userId);
    case "create_spending_goal":
      return createSpendingGoal(call.arguments, userId);
    case "log_spending":
      return logSpending(call.arguments, userId);
    case "add_occasion":
      return addOccasion(call.arguments, userId);
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
     WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'running', 'missed')
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

  const tzRows = await query<{ timezone: string | null }>(
    `SELECT timezone FROM users WHERE id = $1`,
    [userId]
  );
  const tz = resolveTimezone(tzRows[0]?.timezone);

  if (target === "drop") {
    const rows = await query<{ id: string }>(
      `UPDATE blocks SET status = 'dropped'
       WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'running', 'missed')
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

  if (target === "add_15") {
    // Extend the block so it ends 15 minutes later, rather than
    // pushing the start into the future.
    const newDuration = blocks[0].duration_minutes + 15;
    await query(
      `UPDATE blocks SET duration_minutes = $1
       WHERE id = $2 AND user_id = $3`,
      [newDuration, blockId, userId]
    );

    return {
      tool: "move_block",
      success: true,
      message: `Block extended to ${newDuration} minutes.`,
      data: {
        block_id: blockId,
        rowChange: {
          table: "blocks",
          operation: "update" as const,
          row_id: blockId,
          changes: { duration_minutes: newDuration },
        },
      },
    };
  }

  let newStart: Date;

  if (target === "later_today") {
    newStart = nextLocalTime(tz, now, 18, 45);
  } else if (target === "tomorrow_morning") {
    newStart = tomorrowLocalTime(tz, now, 9, 0);
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

// ─── update_block ────────────────────────────────────────────

async function updateBlock(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const blockId = args.block_id as string;
  const title = (args.title as string).trim();

  const rows = await query<{ id: string }>(
    `UPDATE blocks SET title = $1
     WHERE id = $2 AND user_id = $3 AND status IN ('scheduled', 'running')
     RETURNING id`,
    [title, blockId, userId]
  );

  if (!rows[0]) {
    return {
      tool: "update_block",
      success: false,
      message: "Block not found or already completed.",
    };
  }

  return {
    tool: "update_block",
    success: true,
    message: `Block renamed to "${title}".`,
    data: {
      block_id: blockId,
      title,
      rowChange: {
        table: "blocks",
        operation: "update" as const,
        row_id: blockId,
        changes: { title },
      },
    },
  };
}

// ─── create_spending_goal ────────────────────────────────────

async function createSpendingGoal(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const label = (args.label as string).trim();
  const monthlyAmount = args.monthly_amount as number;

  // A matching target counts as already existing — the home screen
  // keys on labels, so duplicates would render twice.
  const existing = await query<{ id: string }>(
    `SELECT id FROM spending_goals WHERE user_id = $1 AND LOWER(label) = LOWER($2)`,
    [userId, label]
  );
  if (existing[0]) {
    return {
      tool: "create_spending_goal",
      success: true,
      message: `A spending target called "${label}" already exists.`,
      data: { spending_goal_id: existing[0].id },
    };
  }

  const budgetCents = Math.round(monthlyAmount * 100);
  const rows = await query<{ id: string }>(
    `INSERT INTO spending_goals (user_id, label, budget_cents)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, label, budgetCents]
  );

  const goalId = rows[0].id;
  return {
    tool: "create_spending_goal",
    success: true,
    message: `Spending target "${label}" created at $${monthlyAmount} a month.`,
    data: {
      spending_goal_id: goalId,
      rowChange: {
        table: "spending_goals",
        operation: "insert" as const,
        row_id: goalId,
        changes: { label, monthly_amount: monthlyAmount },
      },
    },
  };
}

// ─── log_spending ────────────────────────────────────────────

async function logSpending(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const label = (args.spending_goal_label as string).trim();
  const amount = args.amount as number;
  const description = args.description as string | undefined;
  const date = args.date as string | undefined;

  // Resolve the target by name so the user never has to know an id.
  const goals = await query<{ id: string; label: string }>(
    `SELECT id, label FROM spending_goals WHERE user_id = $1 AND LOWER(label) = LOWER($2)`,
    [userId, label]
  );

  if (!goals[0]) {
    const all = await query<{ label: string }>(
      `SELECT label FROM spending_goals WHERE user_id = $1`,
      [userId]
    );
    const available = all.map((g) => `"${g.label}"`).join(", ") || "none";
    return {
      tool: "log_spending",
      success: false,
      message: `No spending target called "${label}" exists. The user has: ${available}. Ask which target to use, or create one with create_spending_goal.`,
    };
  }

  const amountCents = Math.round(amount * 100);
  const rows = await query<{ id: string }>(
    `INSERT INTO spending_entries (user_id, spending_goal_id, amount_cents, description, spent_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, goals[0].id, amountCents, description ?? null, date ?? new Date().toISOString().slice(0, 10)]
  );

  const entryId = rows[0].id;
  return {
    tool: "log_spending",
    success: true,
    message: `$${amount} logged against "${goals[0].label}".`,
    data: {
      spending_entry_id: entryId,
      rowChange: {
        table: "spending_entries",
        operation: "insert" as const,
        row_id: entryId,
        changes: { spending_goal_id: goals[0].id, amount, description, spent_at: date },
      },
    },
  };
}

// ─── add_occasion ────────────────────────────────────────────

async function addOccasion(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const title = (args.title as string).trim();
  const date = args.date as string;
  const note = args.note as string | undefined;

  const rows = await query<{ id: string }>(
    `INSERT INTO occasions (user_id, title, date, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, title, date, note ?? null]
  );

  const occasionId = rows[0].id;
  return {
    tool: "add_occasion",
    success: true,
    message: `"${title}" added for ${date}.`,
    data: {
      occasion_id: occasionId,
      rowChange: {
        table: "occasions",
        operation: "insert" as const,
        row_id: occasionId,
        changes: { title, date, note },
      },
    },
  };
}
