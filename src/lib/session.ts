import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "./auth";
import { isDevBypassEnabled, getDevUser } from "./dev-bypass";

export async function getCurrentUser(): Promise<{ userId: string; email: string; name: string | null } | null> {
  if (isDevBypassEnabled()) {
    return getDevUser();
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;

  const session = await verifySession(sessionToken);
  if (!session) return null;

  const { query } = await import("./db");
  const users = await query<{ name: string | null }>(
    `SELECT name FROM users WHERE id = $1`,
    [session.userId]
  );

  return { userId: session.userId, email: session.email, name: users[0]?.name ?? null };
}
