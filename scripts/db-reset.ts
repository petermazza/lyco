import { pool } from "../src/lib/db";
import { seed } from "./seed";

async function dbReset() {
  console.log("Truncating all application tables...");

  await pool.query(`
    TRUNCATE TABLE
      spending_entries,
      blocks,
      occasions,
      spending_goals,
      goals,
      llm_interactions,
      secrets,
      sessions,
      magic_link_tokens,
      users
    CASCADE
  `);

  console.log("All tables truncated.\n");

  await seed();

  await pool.end();
  console.log("\ndb:reset complete.");
}

dbReset().catch((err) => {
  console.error("db:reset failed:", err);
  process.exit(1);
});
