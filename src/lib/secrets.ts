import crypto from "crypto";
import { query } from "./db";

// ─── Encrypted secrets store ─────────────────────────────────
// OAuth refresh tokens are encrypted with AES-256-GCM using
// AUTH_SECRET as the key. They are never stored in plaintext.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  // Derive a 32-byte key from AUTH_SECRET using SHA-256
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// ─── Public API ──────────────────────────────────────────────

export async function setSecret(userId: string, key: string, value: string): Promise<void> {
  const encrypted = encrypt(value);
  await query(
    `INSERT INTO secrets (user_id, key, value, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, key)
     DO UPDATE SET value = $3, updated_at = now()`,
    [userId, key, encrypted]
  );
}

export async function getSecret(userId: string, key: string): Promise<string | null> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM secrets WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );
  if (!rows[0]) return null;
  return decrypt(rows[0].value);
}

export async function deleteSecret(userId: string, key: string): Promise<void> {
  await query(
    `DELETE FROM secrets WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );
}

export async function hasSecret(userId: string, key: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM secrets WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );
  return rows.length > 0;
}
