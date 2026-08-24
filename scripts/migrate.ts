import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../src/lib/db";

async function migrate() {
  const schemaPath = join(process.cwd(), "design", "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");

  console.log("Running schema.sql...");
  await pool.query(sql);
  console.log("Schema applied successfully.");

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
