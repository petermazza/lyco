import { Pool, type PoolClient } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[]
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never[]);
  return res.rows;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
