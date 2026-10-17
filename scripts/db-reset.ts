import { query, closeDb } from "../src/lib/db";
import { seed } from "./seed";

async function dbReset() {
  // Only wipe test accounts — the database is shared, so a real user's
  // data (and their connected calendar tokens) must never be touched.
  // Child rows cascade off the users delete.
  console.log("Removing @lyco.test users and their data...");

  await query(`DELETE FROM magic_link_tokens WHERE email LIKE '%@lyco.test'`, []);
  await query(`DELETE FROM users WHERE email LIKE '%@lyco.test'`, []);

  console.log("Test data cleared.\n");

  await seed();

  await closeDb();
  console.log("\ndb:reset complete.");
}

dbReset().catch((err) => {
  console.error("db:reset failed:", err);
  process.exit(1);
});
