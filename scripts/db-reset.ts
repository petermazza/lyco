import { query, closeDb } from "../src/lib/db";
import { seed } from "./seed";

async function dbReset() {
  // Prefer the dedicated test database when one is configured; never let a
  // reset run against a Railway host unless explicitly overridden.
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  if (/rlwy\.net|railway\.internal/.test(url) && process.env.ALLOW_SHARED_DB_RESET !== "true") {
    throw new Error(
      "Refusing to run db-reset against a Railway host. " +
        "Set TEST_DATABASE_URL to a local lyco_test database (or ALLOW_SHARED_DB_RESET=true to override)."
    );
  }
  process.env.DATABASE_URL = url;

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
