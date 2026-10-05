import { query } from "./db";
import { sendEmail } from "./email";
import { appUrl } from "./app-url";
import { unsubscribeSignature } from "./auth";
import { resolveTimezone, zonedParts, formatTimeTz } from "./tz";

// ─── Missed-block sweep ──────────────────────────────────────
// Shared rule: a block whose end passed more than GRACE minutes ago
// and was never touched becomes "missed". The home screen calls this
// per user on load; the reminder sweep calls it globally.

export const MISSED_GRACE_MINUTES = 30;

export async function markMissedBlocks(userId: string | null, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MISSED_GRACE_MINUTES * 60000);
  const res = await query<{ id: string }>(
    `UPDATE blocks SET status = 'missed'
     WHERE status IN ('scheduled', 'running')
       AND scheduled_at + (duration_minutes || ' minutes')::interval < $1
       ${userId ? "AND user_id = $2" : ""}
     RETURNING id`,
    userId ? [cutoff, userId] : [cutoff]
  );
  return res.length;
}

// ─── Types ───────────────────────────────────────────────────

export type ReminderKind = "block_start" | "block_checkin" | "occasion";

export interface ReminderSent {
  kind: ReminderKind;
  email: string;
  title: string;
  targetId: string;
  /** false when the address is fake or no mail key is set */
  delivered: boolean;
}

export interface SweepOptions {
  now?: Date;
  /** Limit the sweep to one user — keeps test runs scoped */
  onlyEmail?: string;
  /** Report what would happen without recording or sending */
  dryRun?: boolean;
}

// ─── Windows ─────────────────────────────────────────────────
// A block start counts if it began in the last 2 minutes or begins
// in the next 5 (the cron runs every 5 minutes).
const START_LOOKBACK_MS = 2 * 60000;
const START_LOOKAHEAD_MS = 5 * 60000;
// Check-in goes out 5–20 minutes after a block ends.
const CHECKIN_MIN_MS = 5 * 60000;
const CHECKIN_MAX_MS = 20 * 60000;
// A block created within this window of its own start was just
// scheduled "for right now" — no need to announce it.
const JUST_CREATED_MS = 2 * 60000;
// Flood guards
const BLOCK_MAX_AGE_MS = 24 * 60 * 60000;
const OCCASION_HOUR_MIN = 8;
const OCCASION_HOUR_MAX = 21;

// ─── Sweep ───────────────────────────────────────────────────

export async function runReminderSweep(opts: SweepOptions = {}): Promise<ReminderSent[]> {
  const now = opts.now ?? new Date();
  const sent: ReminderSent[] = [];

  // Keep missed statuses fresh for everyone first.
  await markMissedBlocks(null, now);

  const users = await query<{
    id: string;
    email: string;
    timezone: string | null;
    reminder_emails: boolean;
  }>(
    `SELECT id, email, timezone, reminder_emails FROM users
     ${opts.onlyEmail ? "WHERE email = $1" : ""}`,
    opts.onlyEmail ? [opts.onlyEmail] : []
  );

  for (const user of users) {
    if (!user.reminder_emails) continue;
    const tz = resolveTimezone(user.timezone);
    const local = zonedParts(tz, now);

    // ─── Blocks starting now ──────────────────────────────
    const starting = await query<{
      id: string; title: string; scheduled_at: Date; duration_minutes: number; created_at: Date;
    }>(
      `SELECT id, title, scheduled_at, duration_minutes, created_at
       FROM blocks
       WHERE user_id = $1 AND status = 'scheduled'
         AND scheduled_at >= $2 AND scheduled_at <= $3
         AND scheduled_at >= $4`,
      [
        user.id,
        new Date(now.getTime() - START_LOOKBACK_MS),
        new Date(now.getTime() + START_LOOKAHEAD_MS),
        new Date(now.getTime() - BLOCK_MAX_AGE_MS),
      ]
    );

    for (const b of starting) {
      const start = new Date(b.scheduled_at);
      // Skip blocks scheduled at the very moment they were created
      if (start.getTime() - new Date(b.created_at).getTime() < JUST_CREATED_MS) continue;
      const end = new Date(start.getTime() + b.duration_minutes * 60000);
      await deliver({
        kind: "block_start",
        user,
        targetId: b.id,
        targetKey: start,
        title: b.title,
        dryRun: opts.dryRun,
        subject: `Starting now — ${b.title}`,
        html: reminderHtml(
          `${b.title} · ${b.duration_minutes} minutes, until ${formatTimeTz(tz, end)}.`,
          user.id
        ),
      }, sent);
    }

    // ─── Check-in: block ended recently and is still open ──
    const ended = await query<{
      id: string; title: string; scheduled_at: Date; duration_minutes: number;
    }>(
      `SELECT id, title, scheduled_at, duration_minutes
       FROM blocks
       WHERE user_id = $1 AND status IN ('scheduled', 'running')
         AND scheduled_at + (duration_minutes || ' minutes')::interval <= $2
         AND scheduled_at + (duration_minutes || ' minutes')::interval >= $3
         AND scheduled_at >= $4`,
      [
        user.id,
        new Date(now.getTime() - CHECKIN_MIN_MS),
        new Date(now.getTime() - CHECKIN_MAX_MS),
        new Date(now.getTime() - BLOCK_MAX_AGE_MS),
      ]
    );

    for (const b of ended) {
      const end = new Date(new Date(b.scheduled_at).getTime() + b.duration_minutes * 60000);
      await deliver({
        kind: "block_checkin",
        user,
        targetId: b.id,
        targetKey: end,
        title: b.title,
        dryRun: opts.dryRun,
        subject: `How did it go? — ${b.title}`,
        html: reminderHtml(
          `Your ${b.duration_minutes}-minute block wrapped at ${formatTimeTz(tz, end)}. Mark it done, move it, or drop it — it's waiting on your home screen.`,
          user.id
        ),
      }, sent);
    }

    // ─── Occasion heads-up: 7 days and 1 day before ───────
    if (local.hour >= OCCASION_HOUR_MIN && local.hour < OCCASION_HOUR_MAX) {
      const localDate = (daysAhead: number) => {
        const d = new Date(Date.UTC(local.year, local.month - 1, local.day + daysAhead));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      };
      const in7 = localDate(7);
      const in1 = localDate(1);

      const occasions = await query<{ id: string; title: string; date: string | Date }>(
        `SELECT id, title, date FROM occasions
         WHERE user_id = $1 AND date IN ($2, $3)`,
        [user.id, in7, in1]
      );

      for (const o of occasions) {
        const dateStr = o.date instanceof Date
          ? `${o.date.getFullYear()}-${String(o.date.getMonth() + 1).padStart(2, "0")}-${String(o.date.getDate()).padStart(2, "0")}`
          : o.date;
        const days = dateStr === in7 ? 7 : 1;
        await deliver({
          kind: "occasion",
          user,
          targetId: o.id,
          // The day this reminder fires — so the 1-day heads-up
          // isn't deduped against the 7-day one.
          targetKey: now,
          title: o.title,
          dryRun: opts.dryRun,
          subject: days === 1 ? `${o.title} is tomorrow` : `${o.title} is in a week`,
          html: reminderHtml(
            days === 1
              ? `${o.title} is tomorrow.`
              : `${o.title} is in 7 days.`,
            user.id
          ),
        }, sent);
      }
    }
  }

  return sent;
}

// ─── Helpers ─────────────────────────────────────────────────

interface DeliverArgs {
  kind: ReminderKind;
  user: { id: string; email: string };
  targetId: string;
  targetKey: Date;
  title: string;
  subject: string;
  html: string;
  dryRun?: boolean;
}

async function deliver(args: DeliverArgs, sent: ReminderSent[]): Promise<void> {
  const record: ReminderSent = {
    kind: args.kind,
    email: args.user.email,
    title: args.title,
    targetId: args.targetId,
    delivered: false,
  };

  if (args.dryRun) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM reminders WHERE kind = $1 AND target_id = $2 AND target_key = $3`,
      [args.kind, args.targetId, args.targetKey]
    );
    if (!existing[0]) sent.push(record);
    return;
  }

  // Claim the slot first — if another sweep already sent this, skip.
  const inserted = await query<{ id: string }>(
    `INSERT INTO reminders (user_id, kind, target_id, target_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, target_id, target_key) DO NOTHING
     RETURNING id`,
    [args.user.id, args.kind, args.targetId, args.targetKey]
  );
  if (!inserted[0]) return;

  try {
    const result = await sendEmail(args.user.email, args.subject, args.html);
    record.delivered = result.sent;
  } catch (err) {
    // Let the next run retry this one.
    await query(`DELETE FROM reminders WHERE id = $1`, [inserted[0].id]);
    throw err;
  }
  sent.push(record);
}

function reminderHtml(line: string, userId: string): string {
  const home = appUrl();
  const unsub = `${home}/api/user/reminders?u=${userId}&sig=${unsubscribeSignature(userId)}`;
  return [
    `<p>${line}</p>`,
    `<p><a href="${home}">Open lyco</a></p>`,
    `<p style="color:#888;font-size:12px"><a href="${unsub}">stop these emails</a></p>`,
  ].join("");
}
