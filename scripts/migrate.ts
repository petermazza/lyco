import { readFileSync } from "fs";
import { join } from "path";
import { closeDb } from "../src/lib/db";
import { query } from "../src/lib/db";

async function migrate() {
  const schemaPath = join(process.cwd(), "design", "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");

  console.log("Running schema.sql...");
  await query(sql, []);
  console.log("Schema applied successfully.");

  await closeDb();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
