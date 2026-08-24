import { query } from "./db";

const DEV_USER_ID = process.env.DEV_USER_ID;
const NODE_ENV = process.env.NODE_ENV ?? "development";

if (DEV_USER_ID && NODE_ENV === "production") {
  throw new Error(
    "FATAL: DEV_USER_ID is set but NODE_ENV is 'production'. " +
      "The development auth bypass must never be enabled in production. " +
      "Remove DEV_USER_ID from the environment."
  );
}

if (DEV_USER_ID) {
  console.warn(
    `\n` +
      `┌──────────────────────────────────────────────────────────────┐\n` +
      `│  ⚠  DEV AUTH BYPASS ACTIVE                                    │\n` +
      `│  All requests authenticated as user ${DEV_USER_ID.slice(0, 8)}…             │\n` +
      `│  Magic-link auth is bypassed. Do NOT use in production.       │\n` +
      `└──────────────────────────────────────────────────────────────┘\n`
  );
}

export function isDevBypassEnabled(): boolean {
  return !!DEV_USER_ID && NODE_ENV !== "production";
}

export async function getDevUser(): Promise<{
  userId: string;
  email: string;
  name: string | null;
} | null> {
  if (!isDevBypassEnabled() || !DEV_USER_ID) return null;

  const rows = await query<{ id: string; email: string; name: string | null }>(
    `SELECT id, email, name FROM users WHERE id = $1`,
    [DEV_USER_ID]
  );

  if (rows[0]) {
    return { userId: rows[0].id, email: rows[0].email, name: rows[0].name };
  }

  const created = await query<{ id: string; email: string; name: string | null }>(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, email, name`,
    [DEV_USER_ID, "dev@lyco.local", "Dev"]
  );

  if (created[0]) {
    console.log(`[dev-bypass] Created dev user: ${created[0].email} (${created[0].id})`);
    return { userId: created[0].id, email: created[0].email, name: created[0].name };
  }

  const retry = await query<{ id: string; email: string; name: string | null }>(
    `SELECT id, email, name FROM users WHERE id = $1`,
    [DEV_USER_ID]
  );

  return retry[0]
    ? { userId: retry[0].id, email: retry[0].email, name: retry[0].name }
    : null;
}
