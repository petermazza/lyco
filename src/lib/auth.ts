import crypto from "crypto";
import { pool, query } from "./db";

const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-secret";
const SESSION_COOKIE = "lyco_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MINUTES = 15;

// ─── Hashing ─────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET).update(token).digest("hex");
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Magic link flow ─────────────────────────────────────────

export async function createMagicLink(email: string): Promise<{ token: string; link: string }> {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO magic_link_tokens (email, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [email.toLowerCase(), tokenHash, expiresAt]
  );

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const link = `${base}/api/auth/verify?token=${token}`;
  return { token, link };
}

export async function verifyMagicLink(token: string): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);

  const rows = await query<{ id: string; email: string; used_at: string | null; expires_at: string }>(
    `SELECT id, email, used_at, expires_at
     FROM magic_link_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Mark token as used
  await query(`UPDATE magic_link_tokens SET used_at = now() WHERE id = $1`, [row.id]);

  // Find or create user
  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [row.email]
  );

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    const created = await query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [row.email]
    );
    userId = created[0].id;
  }

  return { userId, email: row.email };
}

// ─── Session management ──────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function verifySession(sessionToken: string): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(sessionToken);

  const rows = await query<{ user_id: string; email: string; expires_at: string }>(
    `SELECT s.user_id, u.email, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return { userId: row.user_id, email: row.email };
}

export async function deleteSession(sessionToken: string): Promise<void> {
  const tokenHash = hashToken(sessionToken);
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

// ─── Cookie helpers ──────────────────────────────────────────

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_COOKIE_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;

export async function cleanupExpiredTokens(): Promise<void> {
  await pool.query(`DELETE FROM magic_link_tokens WHERE expires_at < now()`);
  await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
}
