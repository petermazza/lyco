// ─── Tool definitions for the LLM ────────────────────────────
// The model calls these functions — it never generates SQL or
// writes to the database directly. Every tool has validated
// arguments defined as JSON Schema, matching Anthropic's tool
// use format.

export type ToolName =
  | "create_goal"
  | "update_goal"
  | "schedule_block"
  | "complete_block"
  | "move_block"
  | "update_block"
  | "create_spending_goal"
  | "log_spending"
  | "add_occasion";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "create_goal",
    description:
      "Create a new goal (project) for the user. Use this when the user describes what they want to accomplish. " +
      "You must collect a title at minimum. Deadline and cadence are optional but helpful.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A short, clear title for the goal. e.g. 'New job — 5 first rounds'",
        },
        deadline: {
          type: "string",
          description: "Target deadline as an ISO date string (YYYY-MM-DD). Omit if the user has no specific deadline.",
        },
        cadence: {
          type: "string",
          description: "How often time should be held for this goal. e.g. '2x a week', 'weekly', 'weekday mornings'",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_goal",
    description:
      "Update an existing goal's title, deadline, cadence, or status. " +
      "Only the fields you want to change need to be provided.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: {
          type: "string",
          description: "The UUID of the goal to update.",
        },
        title: {
          type: "string",
          description: "New title for the goal.",
        },
        deadline: {
          type: "string",
          description: "New deadline as an ISO date string (YYYY-MM-DD), or null to remove the deadline.",
        },
        cadence: {
          type: "string",
          description: "New cadence for the goal.",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "done"],
          description: "New status for the goal.",
        },
      },
      required: ["goal_id"],
    },
  },
  {
    name: "schedule_block",
    description:
      "Schedule a time block on the user's calendar for a goal. " +
      "The block has a title, a start time, and a duration. " +
      "If a goal_id is provided, the block is linked to that goal.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: {
          type: "string",
          description: "The UUID of the goal this block is for. Omit for standalone blocks.",
        },
        title: {
          type: "string",
          description: "What the user will do during this block. e.g. 'Rewrite the résumé summary'",
        },
        scheduled_at: {
          type: "string",
          description: "Start time as an ISO 8601 datetime string. e.g. '2025-10-15T19:00:00'",
        },
        duration_minutes: {
          type: "integer",
          description: "Duration of the block in minutes. e.g. 90 for 1.5 hours.",
          minimum: 5,
          maximum: 480,
        },
      },
      required: ["title", "scheduled_at", "duration_minutes"],
    },
  },
  {
    name: "complete_block",
    description:
      "Mark a scheduled or running block as done. " +
      "Use this when the user says they finished the work in a block.",
    input_schema: {
      type: "object",
      properties: {
        block_id: {
          type: "string",
          description: "The UUID of the block to mark as done.",
        },
      },
      required: ["block_id"],
    },
  },
  {
    name: "move_block",
    description:
      "Move a block to a different time, or drop it. " +
      "Use this when the user wants to reschedule or cancel a block.",
    input_schema: {
      type: "object",
      properties: {
        block_id: {
          type: "string",
          description: "The UUID of the block to move.",
        },
        target: {
          type: "string",
          enum: ["later_today", "tomorrow_morning", "add_15", "drop"],
          description:
            "Where to move the block. " +
            "'later_today' moves to 6:45 pm today. " +
            "'tomorrow_morning' moves to 9:00 am tomorrow. " +
            "'add_15' adds 15 minutes to the current time. " +
            "'drop' cancels the block entirely.",
        },
      },
      required: ["block_id", "target"],
    },
  },
  {
    name: "update_block",
    description:
      "Change what a block is about — its title. " +
      "Use this when the user agrees to tackle a smaller or different task during a block.",
    input_schema: {
      type: "object",
      properties: {
        block_id: {
          type: "string",
          description: "The UUID of the block to rename.",
        },
        title: {
          type: "string",
          description: "The new task for this block, as a short plain sentence.",
        },
      },
      required: ["block_id", "title"],
    },
  },
  {
    name: "create_spending_goal",
    description:
      "Create a monthly spending target the user wants to keep an eye on, " +
      "like 'eating out' or 'clothes'. Use this when the user names a category and a monthly limit.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "A short category name in plain words. e.g. 'eating out', 'groceries'.",
        },
        monthly_amount: {
          type: "number",
          description: "The monthly limit in whole currency units. e.g. 240 for $240.",
          minimum: 1,
        },
      },
      required: ["label", "monthly_amount"],
    },
  },
  {
    name: "log_spending",
    description:
      "Record a purchase against one of the user's spending targets. " +
      "Use this when the user says they bought something. The spending_goal_label should match an existing target; " +
      "if the user has no matching target, ask which one to use or create it with create_spending_goal first.",
    input_schema: {
      type: "object",
      properties: {
        spending_goal_label: {
          type: "string",
          description: "The name of the spending target this purchase belongs to, e.g. 'eating out'. Case-insensitive.",
        },
        amount: {
          type: "number",
          description: "The purchase amount in currency units. e.g. 12.50 for $12.50.",
          minimum: 0.01,
        },
        description: {
          type: "string",
          description: "A short note about the purchase. e.g. 'lunch with Sam'.",
        },
        date: {
          type: "string",
          description: "When the purchase happened, as YYYY-MM-DD. Defaults to today.",
        },
      },
      required: ["spending_goal_label", "amount"],
    },
  },
  {
    name: "add_occasion",
    description:
      "Add an upcoming date the user wants to be reminded of, like a birthday or trip. " +
      "It shows up in the 'coming up' section of their home screen.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "What the date is for. e.g. \"Mum's birthday\", 'Anniversary trip'.",
        },
        date: {
          type: "string",
          description: "The date as YYYY-MM-DD.",
        },
        note: {
          type: "string",
          description: "An optional extra note shown under the title.",
        },
      },
      required: ["title", "date"],
    },
  },
];

// ─── Validation ──────────────────────────────────────────────

export interface ToolCall {
  name: ToolName;
  arguments: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isISODate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isISODateTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(value);
}

function isUUID(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateToolCall(call: ToolCall): ValidationResult {
  const errors: string[] = [];
  const args = call.arguments;

  switch (call.name) {
    case "create_goal": {
      if (typeof args.title !== "string" || args.title.trim().length === 0) {
        errors.push("title is required and must be a non-empty string");
      }
      if (args.deadline !== undefined && !isISODate(args.deadline)) {
        errors.push("deadline must be an ISO date string (YYYY-MM-DD)");
      }
      if (args.cadence !== undefined && typeof args.cadence !== "string") {
        errors.push("cadence must be a string");
      }
      break;
    }
    case "update_goal": {
      if (!isUUID(args.goal_id)) {
        errors.push("goal_id is required and must be a valid UUID");
      }
      if (args.title !== undefined && typeof args.title !== "string") {
        errors.push("title must be a string");
      }
      if (args.deadline !== undefined && args.deadline !== null && !isISODate(args.deadline)) {
        errors.push("deadline must be an ISO date string (YYYY-MM-DD) or null");
      }
      if (args.cadence !== undefined && typeof args.cadence !== "string") {
        errors.push("cadence must be a string");
      }
      if (args.status !== undefined && !["active", "paused", "done"].includes(args.status as string)) {
        errors.push("status must be one of: active, paused, done");
      }
      break;
    }
    case "schedule_block": {
      if (typeof args.title !== "string" || args.title.trim().length === 0) {
        errors.push("title is required and must be a non-empty string");
      }
      if (!isISODateTime(args.scheduled_at)) {
        errors.push("scheduled_at is required and must be an ISO 8601 datetime string");
      }
      if (typeof args.duration_minutes !== "number" || args.duration_minutes < 5 || args.duration_minutes > 480) {
        errors.push("duration_minutes is required and must be a number between 5 and 480");
      }
      if (args.goal_id !== undefined && !isUUID(args.goal_id)) {
        errors.push("goal_id must be a valid UUID if provided");
      }
      break;
    }
    case "complete_block": {
      if (!isUUID(args.block_id)) {
        errors.push("block_id is required and must be a valid UUID");
      }
      break;
    }
    case "move_block": {
      if (!isUUID(args.block_id)) {
        errors.push("block_id is required and must be a valid UUID");
      }
      if (!["later_today", "tomorrow_morning", "add_15", "drop"].includes(args.target as string)) {
        errors.push("target is required and must be one of: later_today, tomorrow_morning, add_15, drop");
      }
      break;
    }
    case "update_block": {
      if (!isUUID(args.block_id)) {
        errors.push("block_id is required and must be a valid UUID");
      }
      if (typeof args.title !== "string" || args.title.trim().length === 0) {
        errors.push("title is required and must be a non-empty string");
      }
      break;
    }
    case "create_spending_goal": {
      if (typeof args.label !== "string" || args.label.trim().length === 0) {
        errors.push("label is required and must be a non-empty string");
      }
      if (typeof args.monthly_amount !== "number" || args.monthly_amount <= 0) {
        errors.push("monthly_amount is required and must be a positive number");
      }
      break;
    }
    case "log_spending": {
      if (typeof args.spending_goal_label !== "string" || args.spending_goal_label.trim().length === 0) {
        errors.push("spending_goal_label is required and must be a non-empty string");
      }
      if (typeof args.amount !== "number" || args.amount <= 0) {
        errors.push("amount is required and must be a positive number");
      }
      if (args.description !== undefined && typeof args.description !== "string") {
        errors.push("description must be a string");
      }
      if (args.date !== undefined && !isISODate(args.date)) {
        errors.push("date must be an ISO date string (YYYY-MM-DD)");
      }
      break;
    }
    case "add_occasion": {
      if (typeof args.title !== "string" || args.title.trim().length === 0) {
        errors.push("title is required and must be a non-empty string");
      }
      if (!isISODate(args.date)) {
        errors.push("date is required and must be an ISO date string (YYYY-MM-DD)");
      }
      if (args.note !== undefined && typeof args.note !== "string") {
        errors.push("note must be a string");
      }
      break;
    }
    default:
      errors.push(`Unknown tool: ${call.name}`);
  }

  return { ok: errors.length === 0, errors };
}
