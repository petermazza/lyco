// Runs the reminder sweep once. Railway cron calls this every 5
// minutes; locally it can be run by hand. Options:
//   --at <ISO>      sweep as if it were that moment (tests)
//   --only <email>  limit to one user (tests, debugging)
//   --dry-run       report what would send without recording/sending
//   --json          print the results as one JSON line on stdout

import { runReminderSweep } from "../src/lib/reminders";
import { pool } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const at = flag("--at");
  const only = flag("--only");
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");

  const now = at ? new Date(at) : new Date();
  if (isNaN(now.getTime())) {
    console.error(`Invalid --at time: ${at}`);
    process.exit(1);
  }

  const sent = await runReminderSweep({ now, onlyEmail: only, dryRun });

  if (json) {
    console.log(JSON.stringify(sent));
  } else {
    if (sent.length === 0) {
      console.log("No reminders due.");
    }
    for (const r of sent) {
      const tag = r.delivered ? "sent" : "logged";
      console.log(`${tag} · ${r.kind} · ${r.email} · ${r.title}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Reminder sweep failed:", err);
  process.exit(1);
});
