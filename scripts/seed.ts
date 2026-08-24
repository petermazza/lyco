import { pool, query } from "../src/lib/db";

async function seed() {
  // ─── Create test user ──────────────────────────────────────
  const email = "sam@lyco.test";

  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email]
  );

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
    console.log(`User already exists: ${email} (${userId})`);
  } else {
    const [user] = await query<{ id: string }>(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      [email, "Sam"]
    );
    userId = user.id;
    console.log(`Created user: ${email} (${userId})`);
  }

  // ─── Clean up existing data for this user ──────────────────
  await query(`DELETE FROM spending_entries WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM blocks WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM occasions WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM spending_goals WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM goals WHERE user_id = $1`, [userId]);

  // ─── Insert two goals ──────────────────────────────────────
  const goals = await query<{ id: string; title: string }>(
    `INSERT INTO goals (user_id, title, deadline, cadence)
     VALUES
       ($1, 'New job — 5 first rounds', '2025-10-31', '2x a week'),
       ($1, 'Write the weekly digest prompt', NULL, 'weekly')
     RETURNING id, title`,
    [userId]
  );

  goals.forEach((g) => console.log(`  Goal: ${g.title} (${g.id})`));

  // ─── Insert two spending goals ─────────────────────────────
  const spendingGoals = await query<{ id: string; label: string }>(
    `INSERT INTO spending_goals (user_id, label, budget_cents, period)
     VALUES
       ($1, 'Eating out', 24000, 'monthly'),
       ($1, 'Rideshare', 8000, 'monthly')
     RETURNING id, label`,
    [userId]
  );

  spendingGoals.forEach((s) => console.log(`  Spending goal: ${s.label} (${s.id})`));

  // ─── Insert spending entries this month ────────────────────
  const eatingOutId = spendingGoals.find((s) => s.label === "Eating out")?.id;
  const rideshareId = spendingGoals.find((s) => s.label === "Rideshare")?.id;

  if (eatingOutId) {
    // $186 total across several entries
    const eatingEntries = [4200, 3800, 5500, 2800, 2300];
    for (const cents of eatingEntries) {
      await query(
        `INSERT INTO spending_entries (user_id, spending_goal_id, amount_cents, description, spent_at)
         VALUES ($1, $2, $3, $4, CURRENT_DATE - (random() * 20)::int)`,
        [userId, eatingOutId, cents, "restaurant"]
      );
    }
    console.log(`  Eating out entries: $${eatingEntries.reduce((a, b) => a + b, 0) / 100} total`);
  }

  if (rideshareId) {
    // $92 total
    const rideEntries = [2400, 1800, 3200, 1800];
    for (const cents of rideEntries) {
      await query(
        `INSERT INTO spending_entries (user_id, spending_goal_id, amount_cents, description, spent_at)
         VALUES ($1, $2, $3, $4, CURRENT_DATE - (random() * 20)::int)`,
        [userId, rideshareId, cents, "ride"]
      );
    }
    console.log(`  Rideshare entries: $${rideEntries.reduce((a, b) => a + b, 0) / 100} total`);
  }

  // ─── Insert blocks for today ───────────────────────────────
  const now = new Date();
  const todayBlocks = [
    { title: "Draft the SimpleFIN adapter", offsetMin: -20, duration: 90, progress: 22, status: "running" },
    { title: "Walk, no phone", offsetMin: 75, duration: 30, progress: 0, status: "scheduled" },
    { title: "Write the weekly digest prompt", offsetMin: 120, duration: 45, progress: 0, status: "scheduled" },
    { title: "Call Dad", offsetMin: 180, duration: 20, progress: 0, status: "scheduled" },
  ];

  for (const b of todayBlocks) {
    const scheduledAt = new Date(now.getTime() + b.offsetMin * 60000);
    await query(
      `INSERT INTO blocks (user_id, title, scheduled_at, duration_minutes, status, progress)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, b.title, scheduledAt, b.duration, b.status, b.progress]
    );
  }
  console.log(`  Today's blocks: ${todayBlocks.length}`);

  // ─── Insert historical blocks this month for ratio ─────────
  // 23 done + 4 dropped = 27 historical, + 4 today = 31 total
  const goalId = goals[0]?.id;
  for (let i = 0; i < 23; i++) {
    await query(
      `INSERT INTO blocks (user_id, goal_id, title, scheduled_at, duration_minutes, status, progress)
       VALUES ($1, $2, $3, CURRENT_DATE - ($4 || ' days')::interval, 60, 'done', 100)`,
      [userId, goalId, `Earlier block ${i + 1}`, (i + 1).toString()]
    );
  }
  for (let i = 0; i < 4; i++) {
    await query(
      `INSERT INTO blocks (user_id, title, scheduled_at, duration_minutes, status, progress)
       VALUES ($1, $2, CURRENT_DATE - ($3 || ' days')::interval, 45, 'dropped', 0)`,
      [userId, `Dropped block ${i + 1}`, (i + 3).toString()]
    );
  }
  console.log(`  Historical blocks: 23 done, 4 dropped`);

  // ─── Insert an occasion ────────────────────────────────────
  await query(
    `INSERT INTO occasions (user_id, title, date, note)
     VALUES ($1, 'Mom''s birthday', CURRENT_DATE + 12, 'gift idea logged: the ceramics class. order by the 30th to arrive in time.')`,
    [userId]
  );
  console.log(`  Occasion: Mom's birthday (12 days away)`);

  // ─── Verify: query back as that user ───────────────────────
  console.log("\n── Verification ──");

  const userRows = await query<{ id: string; email: string; name: string | null }>(
    `SELECT id, email, name FROM users WHERE id = $1`,
    [userId]
  );
  console.log("User:", userRows[0]);

  const goalRows = await query<{ id: string; title: string; deadline: string | null; cadence: string | null }>(
    `SELECT id, title, deadline, cadence FROM goals WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  console.log("Goals:", goalRows);

  const spendingRows = await query<{ id: string; label: string; budget_cents: number; period: string }>(
    `SELECT id, label, budget_cents, period FROM spending_goals WHERE user_id = $1`,
    [userId]
  );
  console.log("Spending goals:", spendingRows);

  const todayBlockRows = await query<{ id: string; title: string; scheduled_at: Date; status: string; progress: number }>(
    `SELECT id, title, scheduled_at, status, progress FROM blocks
     WHERE user_id = $1 AND scheduled_at::date = CURRENT_DATE
     ORDER BY scheduled_at`,
    [userId]
  );
  console.log("Today's blocks:");
  todayBlockRows.forEach((b) => console.log(`  ${b.title} · ${b.scheduled_at.toISOString()} · ${b.status} · ${b.progress}%`));

  const spendingTotals = await query<{ label: string; total: string; budget_cents: number }>(
    `SELECT sg.label, COALESCE(SUM(se.amount_cents), 0)::text AS total, sg.budget_cents
     FROM spending_goals sg
     LEFT JOIN spending_entries se ON se.spending_goal_id = sg.id AND se.spent_at >= date_trunc('month', CURRENT_DATE)
     WHERE sg.user_id = $1
     GROUP BY sg.label, sg.budget_cents`,
    [userId]
  );
  console.log("Spending totals:");
  spendingTotals.forEach((s) => console.log(`  ${s.label}: $${parseInt(s.total) / 100} of $${s.budget_cents / 100}`));

  const ratioRows = await query<{ kept: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'done') AS kept,
       COUNT(*) AS total
     FROM blocks
     WHERE user_id = $1
       AND scheduled_at >= date_trunc('month', CURRENT_DATE)`,
    [userId]
  );
  console.log(`Ratio: ${ratioRows[0].kept} kept of ${ratioRows[0].total} total`);

  const occasionRows = await query<{ title: string; date: string; note: string | null }>(
    `SELECT title, date, note FROM occasions WHERE user_id = $1 ORDER BY date`,
    [userId]
  );
  console.log("Occasions:", occasionRows);

  await pool.end();
  console.log("\nSeed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
