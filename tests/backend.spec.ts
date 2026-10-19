import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import crypto from "crypto";
import pg from "pg";
import { executeTools } from "../src/lib/tool-executor";
import { validateToolCall } from "../src/lib/tools";
import { setSecret, deleteSecret } from "../src/lib/secrets";

const BASE = "http://localhost:3001";

// ─── Test DB access (reads .env.local for DATABASE_URL) ──────

function dbUrl(): string {
  const env = readFileSync(".env.local", "utf-8");
  const test = env.match(/^TEST_DATABASE_URL=["']?(.+?)["']?\s*$/m);
  if (test) return test[1];
  const match = env.match(/^DATABASE_URL=["']?(.+?)["']?\s*$/m);
  if (!match) throw new Error("TEST_DATABASE_URL or DATABASE_URL not found in .env.local");
  return match[1];
}

function envVar(name: string): string {
  const env = readFileSync(".env.local", "utf-8");
  const match = env.match(new RegExp(`^${name}=["']?(.+?)["']?\\s*$`, "m"));
  return match ? match[1] : "";
}

// In-process helpers (tool executor, secrets store) read these from
// process.env at call time — point them at the same settings file the
// dev server uses.
process.env.DATABASE_URL ||= dbUrl();
process.env.AUTH_SECRET ||= envVar("AUTH_SECRET") || "dev-secret";
process.env.ANTHROPIC_API_KEY ||= envVar("ANTHROPIC_API_KEY");

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function userIdOf(ctx: Awaited<ReturnType<typeof apiRequest.newContext>>): Promise<string> {
  const me = await (await ctx.get(`${BASE}/api/auth/me`)).json();
  return me.user.id;
}

// ─── Auth API: request-link ──────────────────────────────────

test.describe("POST /api/auth/request-link", () => {
  test("returns ok for valid email", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "test@lyco.test" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    await ctx.dispose();
  });

  test("returns link in development mode", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "test@lyco.test" },
    });
    const body = await res.json();
    expect(body.link).toContain("/api/auth/verify?token=");
    await ctx.dispose();
  });

  test("returns 400 for missing email", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test("returns 400 for invalid email", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "not-an-email" },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test("normalizes email to lowercase", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "Test.User@LYCO.TEST" },
    });
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });
});

// ─── Auth API: email integration ─────────────────────────────

test.describe("Email integration", () => {
  test("request-link succeeds in dev mode (RESEND_API_KEY unset, link logged to console)", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "email-dev@lyco.test" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.link).toContain("/api/auth/verify?token=");
    await ctx.dispose();
  });

  test("request-link with RESEND_API_KEY unset still creates a valid session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "email-session@lyco.test" },
    });
    const body = await res.json();
    const verifyRes = await ctx.get(body.link, { maxRedirects: 0 });
    expect([200, 307]).toContain(verifyRes.status());
    const cookieList = await ctx.storageState().then((s) => s.cookies);
    const sessionCookie = cookieList.find((c) => c.name === "lyco_session");
    expect(sessionCookie).toBeTruthy();
    await ctx.dispose();
  });
});

// ─── Auth API: verify ────────────────────────────────────────

test.describe("GET /api/auth/verify", () => {
  test("returns 400 for missing token", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/auth/verify`);
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test("returns 401 for invalid token", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/auth/verify?token=invalidtoken123`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("valid token creates session and redirects to /", async () => {
    const ctx = await apiRequest.newContext();
    // Request a magic link
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "auth-test@lyco.test" },
    });
    const body = await res.json();
    const link = body.link;

    // Visit the verify link — should redirect to /
    const verifyRes = await ctx.get(link, { maxRedirects: 0 });
    expect([200, 307]).toContain(verifyRes.status());
    if (verifyRes.status() === 307) {
      const location = verifyRes.headers()["location"];
      expect(location).toContain("/");
    }

    // Check that session cookie was set
    const cookies = ctx.storageState().then((s) => s.cookies);
    const cookieList = await cookies;
    const sessionCookie = cookieList.find((c) => c.name === "lyco_session");
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);

    await ctx.dispose();
  });

  test("token cannot be reused", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "reuse-test@lyco.test" },
    });
    const body = await res.json();
    const link = body.link;

    // First use — should succeed
    const first = await ctx.get(link, { maxRedirects: 0 });
    expect([200, 307]).toContain(first.status());

    // Second use — should fail
    const second = await ctx.get(link, { maxRedirects: 0 });
    expect(second.status()).toBe(401);

    await ctx.dispose();
  });
});

// ─── Auth API: me ────────────────────────────────────────────

test.describe("GET /api/auth/me", () => {
  test("returns null user without session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/auth/me`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user).toBeNull();
    await ctx.dispose();
  });

  test("returns user with valid session", async () => {
    const ctx = await apiRequest.newContext();
    // Create magic link and verify
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "me-test@lyco.test" },
    });
    const body = await res.json();
    await ctx.get(body.link, { maxRedirects: 0 });

    // Now check /api/auth/me
    const meRes = await ctx.get(`${BASE}/api/auth/me`);
    const meBody = await meRes.json();
    expect(meBody.user).toBeTruthy();
    expect(meBody.user.email).toBe("me-test@lyco.test");
    expect(meBody.user.id).toBeTruthy();

    await ctx.dispose();
  });
});

// ─── Auth API: logout ────────────────────────────────────────

test.describe("POST /api/auth/logout", () => {
  test("clears session and cookie", async () => {
    const ctx = await apiRequest.newContext();
    // Create session
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "logout-test@lyco.test" },
    });
    const body = await res.json();
    await ctx.get(body.link, { maxRedirects: 0 });

    // Verify session exists
    const beforeRes = await ctx.get(`${BASE}/api/auth/me`);
    const beforeBody = await beforeRes.json();
    expect(beforeBody.user).toBeTruthy();

    // Logout
    const logoutRes = await ctx.post(`${BASE}/api/auth/logout`);
    expect(logoutRes.status()).toBe(200);

    // Session should be gone
    const afterRes = await ctx.get(`${BASE}/api/auth/me`);
    const afterBody = await afterRes.json();
    expect(afterBody.user).toBeNull();

    await ctx.dispose();
  });

  test("works without existing session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/logout`);
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });
});

// ─── Auth flow: end-to-end via browser ───────────────────────

test.describe("Auth flow: browser end-to-end", () => {
  test("magic link login flow works in browser", async ({ page, context }) => {
    // Request magic link via API
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "browser-auth@lyco.test" },
    });
    const body = await res.json();
    await ctx.dispose();

    // Visit the verify link in the browser
    await page.goto(body.link);
    await page.waitForLoadState("networkidle");

    // Should be redirected to home
    await expect(page).toHaveURL(/\/$/);

    // Should be logged in
    const meRes = await page.request.get(`${BASE}/api/auth/me`);
    const meBody = await meRes.json();
    expect(meBody.user).toBeTruthy();
    expect(meBody.user.email).toBe("browser-auth@lyco.test");
  });
});

// ─── Database: seed verification ─────────────────────────────

test.describe("Database: seed data", () => {
  test("seed user exists with correct goals and spending goal", async () => {
    // This is verified via the API — if the seed ran, the user sam@lyco.test exists
    // We can verify by logging in as that user and checking auth/me
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "sam@lyco.test" },
    });
    const body = await res.json();
    await ctx.get(body.link, { maxRedirects: 0 });

    const meRes = await ctx.get(`${BASE}/api/auth/me`);
    const meBody = await meRes.json();
    expect(meBody.user.email).toBe("sam@lyco.test");

    await ctx.dispose();
  });
});

// ─── Blocks API ──────────────────────────────────────────────
// Unique email per run so leftover blocks from earlier runs
// never interfere with the "current block" assertions.

async function loginCtx(email: string) {
  const ctx = await apiRequest.newContext();
  const res = await ctx.post(`${BASE}/api/auth/request-link`, {
    data: { email },
  });
  const body = await res.json();
  await ctx.get(body.link, { maxRedirects: 0 });
  return ctx;
}

test.describe.serial("GET /api/blocks/current", () => {
  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/blocks/current`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("returns null when nothing is scheduled", async () => {
    const ctx = await loginCtx(`blocks-empty-${Date.now()}@lyco.test`);
    const res = await ctx.get(`${BASE}/api/blocks/current`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.block).toBeNull();
    await ctx.dispose();
  });

  test("returns a block whose window contains now", async () => {
    const ctx = await loginCtx(`blocks-current-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 10 * 60000).toISOString();
    const confirm = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Test goal",
        slots: [{ start, durationMinutes: 90, title: "Deep work session" }],
      },
    });
    expect(confirm.status()).toBe(200);

    const res = await ctx.get(`${BASE}/api/blocks/current`);
    const body = await res.json();
    expect(body.block.title).toBe("Deep work session");
    expect(body.block.durationMinutes).toBe(90);
    await ctx.dispose();
  });

  test("a future block is not current", async () => {
    const ctx = await loginCtx(`blocks-future-${Date.now()}@lyco.test`);
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(9, 0, 0, 0);
    const confirm = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Test goal",
        slots: [{ start: tomorrow.toISOString(), durationMinutes: 60, title: "Future block" }],
      },
    });
    expect(confirm.status()).toBe(200);

    const res = await ctx.get(`${BASE}/api/blocks/current`);
    const body = await res.json();
    expect(body.block).toBeNull();
    await ctx.dispose();
  });
});

test.describe.serial("PATCH /api/blocks/[id]", () => {
  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.patch(`${BASE}/api/blocks/00000000-0000-0000-0000-000000000000`, {
      data: { title: "x" },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("renames a block and rejects empty titles and foreign ids", async () => {
    const ctx = await loginCtx(`blocks-patch-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 5 * 60000).toISOString();
    const confirm = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Test goal",
        slots: [{ start, durationMinutes: 60, title: "Original task" }],
      },
    });
    const { blocks } = await confirm.json();
    const blockId = blocks[0].id;

    const empty = await ctx.patch(`${BASE}/api/blocks/${blockId}`, { data: { title: "  " } });
    expect(empty.status()).toBe(400);

    const missing = await ctx.patch(`${BASE}/api/blocks/00000000-0000-0000-0000-000000000000`, {
      data: { title: "Nope" },
    });
    expect(missing.status()).toBe(404);

    const ok = await ctx.patch(`${BASE}/api/blocks/${blockId}`, {
      data: { title: "Smaller first step" },
    });
    expect(ok.status()).toBe(200);

    const res = await ctx.get(`${BASE}/api/blocks/current`);
    const body = await res.json();
    expect(body.block.title).toBe("Smaller first step");
    await ctx.dispose();
  });
});

test.describe.serial("POST /api/blocks/[id]/move add_15", () => {
  test("extends the block instead of moving the start", async () => {
    const ctx = await loginCtx(`blocks-extend-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 10 * 60000);
    const confirm = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Test goal",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "Extendable" }],
      },
    });
    const { blocks } = await confirm.json();
    const blockId = blocks[0].id;

    const move = await ctx.post(`${BASE}/api/blocks/${blockId}/move`, {
      data: { target: "add_15" },
    });
    expect(move.status()).toBe(200);
    const moveBody = await move.json();
    expect(moveBody.message).toContain("15 minutes added");

    const res = await ctx.get(`${BASE}/api/blocks/current`);
    const body = await res.json();
    expect(body.block.durationMinutes).toBe(75);
    expect(new Date(body.block.scheduledAt).getTime()).toBe(start.getTime());
    await ctx.dispose();
  });
});

// ─── Schedule proposal API ───────────────────────────────────

test.describe.serial("GET /api/schedule/proposal", () => {
  test.setTimeout(60000);

  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/schedule/proposal`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("returns 404 for a user with no goals", async () => {
    const ctx = await loginCtx(`proposal-none-${Date.now()}@lyco.test`);
    const res = await ctx.get(`${BASE}/api/schedule/proposal`);
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });

  test("returns 404 for an unknown goal", async () => {
    const ctx = await loginCtx("sam@lyco.test");
    const res = await ctx.get(
      `${BASE}/api/schedule/proposal?goalId=00000000-0000-0000-0000-000000000000`
    );
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });

  test("proposes real slots for the seeded goal", async () => {
    const ctx = await loginCtx("sam@lyco.test");
    const res = await ctx.get(`${BASE}/api/schedule/proposal?perWeek=2`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.goal.id).toBeTruthy();
    expect(typeof body.goal.title).toBe("string");
    expect(typeof body.reasoning).toBe("string");
    expect(body.reasoning.length).toBeGreaterThan(0);
    expect(body.sessions).toMatch(/that is \d+ sessions/);
    expect(typeof body.calendarConnected).toBe("boolean");
    expect(body.slots.length).toBe(2);

    for (const slot of body.slots) {
      expect(typeof slot.day).toBe("string");
      expect(typeof slot.time).toBe("string");
      expect(typeof slot.history).toBe("string");
      expect(slot.durationMinutes).toBe(90);
      expect(isNaN(new Date(slot.start).getTime())).toBe(false);
      expect(new Date(slot.start).getTime()).toBeGreaterThan(Date.now());
    }
    await ctx.dispose();
  });

  test("perWeek=1 returns a single slot and a different variant", async () => {
    const ctx = await loginCtx("sam@lyco.test");
    const res = await ctx.get(`${BASE}/api/schedule/proposal?perWeek=1&variant=1`);
    const body = await res.json();
    expect(body.slots.length).toBe(1);
    await ctx.dispose();
  });
});

test.describe.serial("POST /api/schedule/confirm", () => {
  test("stores a block for a real goal at a concrete start time", async () => {
    const ctx = await loginCtx("sam@lyco.test");
    const prop = await ctx.get(`${BASE}/api/schedule/proposal?perWeek=1`);
    const { goal, slots } = await prop.json();

    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalId: goal.id,
        goalTitle: goal.title,
        slots: [
          { start: slots[0].start, durationMinutes: slots[0].durationMinutes, title: `${goal.title} — work session` },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blocks.length).toBe(1);
    expect(body.blocks[0].scheduledAt).toBe(slots[0].start);
    await ctx.dispose();
  });

  test("rejects a goal that is not the user's", async () => {
    const ctx = await loginCtx(`confirm-foreign-${Date.now()}@lyco.test`);
    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalId: "00000000-0000-0000-0000-000000000000",
        goalTitle: "Nope",
        slots: [{ start: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 60, title: "x" }],
      },
    });
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });
});

// ─── Timezone API ────────────────────────────────────────────

test.describe.serial("POST /api/user/timezone", () => {
  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/user/timezone`, {
      data: { timezone: "Pacific/Kiritimati" },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("rejects invalid and missing timezones", async () => {
    const ctx = await loginCtx(`tz-bad-${Date.now()}@lyco.test`);
    const invalid = await ctx.post(`${BASE}/api/user/timezone`, {
      data: { timezone: "Mars/Olympus_Mons" },
    });
    expect(invalid.status()).toBe(400);
    const missing = await ctx.post(`${BASE}/api/user/timezone`, { data: {} });
    expect(missing.status()).toBe(400);
    await ctx.dispose();
  });

  test("stores a valid timezone and uses it for block times", async () => {
    const ctx = await loginCtx(`tz-${Date.now()}@lyco.test`);
    // UTC+14 — always several hours ahead of wherever the server runs
    const set = await ctx.post(`${BASE}/api/user/timezone`, {
      data: { timezone: "Pacific/Kiritimati" },
    });
    expect(set.status()).toBe(200);

    // A block that started an hour ago; add_15 ends it 15 min from now
    const start = new Date(Date.now() - 60 * 60000);
    const confirm = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Timed",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "Timed block" }],
      },
    });
    const { blocks } = await confirm.json();
    const move = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, {
      data: { target: "add_15" },
    });
    expect(move.status()).toBe(200);
    const body = await move.json();

    // The message should give the end time in Kiritimati. Allow ±2 min
    // of clock drift between the test and the server.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const squash = (s: string) => s.toLowerCase().replace(/[  ]/g, "").replace(/\s/g, "");
    const endMs = start.getTime() + 75 * 60000;
    const candidates = [-2, -1, 0, 1, 2].map((m) => squash(fmt.format(new Date(endMs + m * 60000))));
    expect(candidates.some((c) => squash(body.message).includes(c))).toBe(true);
    await ctx.dispose();
  });
});

// ─── Missed blocks ───────────────────────────────────────────

test.describe.serial("missed blocks", () => {
  test("a block that ended untouched appears as still open and can be dropped", async () => {
    const ctx = await loginCtx(`missed-${Date.now()}@lyco.test`);
    const title = `Forgotten-${Date.now()}`;
    // Ended an hour ago — past the 30-minute grace period
    const start = new Date(Date.now() - 120 * 60000);
    const confirm = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Cleanup",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title }],
      },
    });
    expect(confirm.status()).toBe(200);

    const home = await ctx.get(`${BASE}/api/home`);
    const body = await home.json();
    const missed = (body.earlier as { id: string; title: string }[]).find((b) => b.title === title);
    expect(missed).toBeTruthy();

    const drop = await ctx.post(`${BASE}/api/blocks/${missed!.id}/move`, {
      data: { target: "drop" },
    });
    expect(drop.status()).toBe(200);

    const home2 = await ctx.get(`${BASE}/api/home`);
    const body2 = await home2.json();
    expect((body2.earlier as { id: string }[]).some((b) => b.id === missed!.id)).toBe(false);
    // The block still counts in this month's total
    expect(body2.total).toBeGreaterThanOrEqual(1);
    await ctx.dispose();
  });

  test("a missed block can be marked done late", async () => {
    const ctx = await loginCtx(`missed-done-${Date.now()}@lyco.test`);
    const title = `Late-${Date.now()}`;
    const start = new Date(Date.now() - 120 * 60000);
    await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Cleanup",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title }],
      },
    });

    const home = await ctx.get(`${BASE}/api/home`);
    const body = await home.json();
    const missed = (body.earlier as { id: string; title: string }[]).find((b) => b.title === title);
    expect(missed).toBeTruthy();

    const done = await ctx.post(`${BASE}/api/blocks/${missed!.id}/done`, { data: {} });
    expect(done.status()).toBe(200);

    const home2 = await ctx.get(`${BASE}/api/home`);
    const body2 = await home2.json();
    expect((body2.earlier as { id: string }[]).some((b) => b.id === missed!.id)).toBe(false);
    expect(body2.kept).toBeGreaterThanOrEqual(1);
    await ctx.dispose();
  });

  test("a block still in progress is not marked missed", async () => {
    const ctx = await loginCtx(`missed-live-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 10 * 60000);
    await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Live",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "In progress" }],
      },
    });

    const home = await ctx.get(`${BASE}/api/home`);
    const body = await home.json();
    expect((body.earlier as { title: string }[]).some((b) => b.title === "In progress")).toBe(false);
    expect(body.currentBlock?.title).toBe("In progress");
    await ctx.dispose();
  });
});

// ─── Chat: spending + occasions ──────────────────────────────
// These run the real model; prompts are explicit so the right
// tool is reliably chosen.

test.describe.serial("chat: spending and dates", () => {
  test.setTimeout(90000);

  test("logging a purchase through chat updates the spending bar", async () => {
    const ctx = await loginCtx("sam@lyco.test");
    const before = await (await ctx.get(`${BASE}/api/home`)).json();
    const eating = (before.spending as { label: string; figure: string }[]).find((s) => s.label === "Eating out");
    expect(eating).toBeTruthy();
    const spent = (f: { figure: string }) => parseInt(f.figure.match(/\$(\d+) of/)![1], 10);

    const chat = await ctx.post(`${BASE}/api/chat`, {
      data: {
        messages: [
          { role: "user", content: "log a $9 purchase on eating out, it was coffee" },
        ],
      },
    });
    expect(chat.status()).toBe(200);
    const body = await chat.json();
    const logged = (body.toolResults as { tool: string; success: boolean }[]).find(
      (r) => r.tool === "log_spending" && r.success
    );
    expect(logged).toBeTruthy();

    const after = await (await ctx.get(`${BASE}/api/home`)).json();
    const eatingAfter = (after.spending as { label: string; figure: string }[]).find((s) => s.label === "Eating out");
    expect(spent(eatingAfter!)).toBe(spent(eating!) + 9);
    await ctx.dispose();
  });

  test("adding an occasion through chat shows it under coming up", async () => {
    const ctx = await loginCtx(`occasion-${Date.now()}@lyco.test`);
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const title = `Trip-${Date.now()}`;

    const chat = await ctx.post(`${BASE}/api/chat`, {
      data: {
        messages: [
          { role: "user", content: `remember "${title}" on ${future} — it's a trip` },
        ],
      },
    });
    expect(chat.status()).toBe(200);
    const body = await chat.json();
    const added = (body.toolResults as { tool: string; success: boolean }[]).find(
      (r) => r.tool === "add_occasion" && r.success
    );
    expect(added).toBeTruthy();

    const home = await (await ctx.get(`${BASE}/api/home`)).json();
    expect((home.upcoming as { title: string }[]).some((o) => o.title === title)).toBe(true);
    await ctx.dispose();
  });
});

// ─── Reminder sweep ──────────────────────────────────────────
// Runs the real `npm run remind` command with an injected time and
// a single-user scope, so nothing outside the test user is touched
// and fake @lyco.test addresses never send real email.

function runRemind(opts: { only: string; at?: Date; dryRun?: boolean }) {
  const args = [`--only ${opts.only}`, "--json"];
  if (opts.at) args.push(`--at ${opts.at.toISOString()}`);
  if (opts.dryRun) args.push("--dry-run");
  const out = execSync(`npm run --silent remind -- ${args.join(" ")}`, {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  const last = out.trim().split("\n").filter(Boolean).pop() ?? "[]";
  return JSON.parse(last) as { kind: string; email: string; title: string; delivered: boolean }[];
}

test.describe.serial("reminder sweep", () => {
  test("emails when a block starts, exactly once", async () => {
    const email = `remind-start-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);

    // Scheduled 3 min out so it isn't "just created for right now"
    const start = new Date(Date.now() + 3 * 60000);
    await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "Deep work" }],
      },
    });

    // Sweep as if it were 1 minute from now
    const at = new Date(Date.now() + 60000);
    const first = runRemind({ only: email, at });
    expect(first.filter((r) => r.kind === "block_start" && r.title === "Deep work")).toHaveLength(1);
    // Fake address — logged, not delivered
    expect(first[0].delivered).toBe(false);

    // Second run sends nothing new
    const second = runRemind({ only: email, at });
    expect(second).toHaveLength(0);
    await ctx.dispose();
  });

  test("does not announce a block created to start right now", async () => {
    const email = `remind-now-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    const start = new Date(Date.now() - 60000); // started 1 min ago, just created
    await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "Right now" }],
      },
    });
    const sent = runRemind({ only: email });
    expect(sent.filter((r) => r.title === "Right now")).toHaveLength(0);
    await ctx.dispose();
  });

  test("check-in goes out after a block ends, but not for a done block", async () => {
    const email = `remind-checkin-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);

    // Both ended 10 minutes ago
    const start = new Date(Date.now() - 70 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [
          { start: start.toISOString(), durationMinutes: 60, title: "Open block" },
          { start: start.toISOString(), durationMinutes: 60, title: "Finished block" },
        ],
      },
    });
    const { blocks } = await conf.json();
    const doneId = blocks.find((b: { title: string }) => b.title === "Finished block").id;
    await ctx.post(`${BASE}/api/blocks/${doneId}/done`, { data: {} });

    const sent = runRemind({ only: email });
    const checkins = sent.filter((r) => r.kind === "block_checkin");
    expect(checkins.map((r) => r.title)).toEqual(["Open block"]);
    await ctx.dispose();
  });

  test("blocks that ended days ago get no catch-up email", async () => {
    const email = `remind-old-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    const start = new Date(Date.now() - 2 * 86400000);
    await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "Ancient" }],
      },
    });
    const sent = runRemind({ only: email });
    expect(sent.filter((r) => r.title === "Ancient")).toHaveLength(0);
    await ctx.dispose();
  });

  test("a moved block re-arms its start reminder at the new time", async () => {
    const email = `remind-move-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);

    const start = new Date(Date.now() + 3 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 60, title: "Movable" }],
      },
    });
    const { blocks } = await conf.json();

    // First reminder at the original time
    const at = new Date(Date.now() + 60000);
    const first = runRemind({ only: email, at });
    expect(first.filter((r) => r.kind === "block_start")).toHaveLength(1);

    // Move it to tomorrow morning, then sweep at that moment
    await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, {
      data: { target: "tomorrow_morning" },
    });
    const tomorrow9 = new Date();
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 1, 0, 0);
    const second = runRemind({ only: email, at: tomorrow9 });
    expect(second.filter((r) => r.kind === "block_start" && r.title === "Movable")).toHaveLength(1);
    await ctx.dispose();
  });

  test("occasion heads-up respects daytime hours", async () => {
    const email = `remind-occ-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);

    // Pin the user's zone so the injected time is deterministic
    await ctx.post(`${BASE}/api/user/timezone`, { data: { timezone: "Pacific/Kiritimati" } });
    const me = await (await ctx.get(`${BASE}/api/auth/me`)).json();

    // Inject "today at 12:00 in Kiritimati" = 22:00 UTC the day before
    const kiritimatiNoon = new Date();
    kiritimatiNoon.setUTCHours(22, 0, 0, 0); // local noon tomorrow-ish in UTC+14
    // The local date at that instant, +7 days → occasion date
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(kiritimatiNoon);
    const y = +(parts.find((p) => p.type === "year")!.value);
    const m = +(parts.find((p) => p.type === "month")!.value);
    const dd = +(parts.find((p) => p.type === "day")!.value);
    const occasionDate = new Date(Date.UTC(y, m - 1, dd + 7)).toISOString().slice(0, 10);

    await withDb(async (c) => {
      await c.query(
        `INSERT INTO occasions (user_id, title, date) VALUES ($1, $2, $3)`,
        [me.user.id, "Mum's birthday", occasionDate]
      );
    });

    // At local noon → one occasion reminder
    const sent = runRemind({ only: email, at: kiritimatiNoon });
    expect(sent.filter((r) => r.kind === "occasion")).toHaveLength(1);

    // At local 3 am → nothing
    const kiritimati3am = new Date(kiritimatiNoon.getTime() - 9 * 3600000);
    const quiet = runRemind({ only: email, at: kiritimati3am, dryRun: true });
    expect(quiet.filter((r) => r.kind === "occasion")).toHaveLength(0);
    await ctx.dispose();
  });

  test("unsubscribe link stops emails; a forged one is rejected", async () => {
    const email = `remind-unsub-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    const me = await (await ctx.get(`${BASE}/api/auth/me`)).json();
    const uid = me.user.id;

    const sig = crypto
      .createHmac("sha256", envVar("AUTH_SECRET") || "dev-secret")
      .update(`unsub:${uid}`)
      .digest("hex")
      .slice(0, 32);

    // Forged signature → 400
    const bad = await ctx.get(`${BASE}/api/user/reminders?u=${uid}&sig=bad`);
    expect(bad.status()).toBe(400);

    // Valid → off, and the flag flips in the DB
    const off = await ctx.get(`${BASE}/api/user/reminders?u=${uid}&sig=${sig}`);
    expect(off.status()).toBe(200);
    expect(await off.text()).toContain("won't get reminder emails");
    let flag = await withDb(async (c) =>
      (await c.query(`SELECT reminder_emails FROM users WHERE id = $1`, [uid])).rows[0].reminder_emails
    );
    expect(flag).toBe(false);

    // Turn back on
    const on = await ctx.get(`${BASE}/api/user/reminders?u=${uid}&sig=${sig}&action=on`);
    expect(on.status()).toBe(200);
    flag = await withDb(async (c) =>
      (await c.query(`SELECT reminder_emails FROM users WHERE id = $1`, [uid])).rows[0].reminder_emails
    );
    expect(flag).toBe(true);
    await ctx.dispose();
  });
});

// ─── Home API contract ───────────────────────────────────────

test.describe.serial("GET /api/home", () => {
  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/home`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("a brand-new user gets an empty home", async () => {
    const ctx = await loginCtx(`home-empty-${Date.now()}@lyco.test`);
    const res = await ctx.get(`${BASE}/api/home`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.hasGoals).toBe(false);
    expect(body.currentBlock).toBeNull();
    expect(body.laterToday).toEqual([]);
    expect(body.earlier).toEqual([]);
    expect(body.spending).toEqual([]);
    expect(body.upcoming).toEqual([]);
    expect(body.kept).toBe(0);
    expect(body.total).toBe(0);
    await ctx.dispose();
  });

  test("the seeded user gets every section with real values", async () => {
    execSync("npm run db:reset", { stdio: "pipe", cwd: process.cwd() });
    const ctx = await loginCtx("sam@lyco.test");
    const res = await ctx.get(`${BASE}/api/home`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.hasGoals).toBe(true);
    expect(typeof body.greeting).toBe("string");
    expect(typeof body.dateLabel).toBe("string");
    expect(typeof body.calendarConnected).toBe("boolean");

    expect(body.currentBlock.title).toBe("Draft the SimpleFIN adapter");
    expect(body.currentBlock.meta).toContain("90 minutes");
    expect(body.currentBlock.left).toMatch(/minutes left/);

    // The seed plants three blocks at +75/+120/+180 min — late in the day
    // some land past midnight and aren't "later today" anymore.
    expect(body.laterToday.length).toBeGreaterThanOrEqual(1);
    const laterTitles = body.laterToday.map((b: { title: string }) => b.title);
    const seeded = ["Walk, no phone", "Write the weekly digest prompt", "Call Dad"];
    expect(laterTitles.some((t: string) => seeded.includes(t))).toBe(true);

    const eating = body.spending.find((s: { label: string }) => s.label === "Eating out");
    const rideshare = body.spending.find((s: { label: string }) => s.label === "Rideshare");
    expect(eating.figure).toBe("$186 of $240");
    expect(rideshare.figure).toBe("$92 of $80");
    expect(rideshare.note).toContain("past the target you set");
    expect(eating.markerLeft).toMatch(/%$/);

    const mom = body.upcoming.find((o: { title: string }) => o.title === "Mom's birthday");
    // The seed writes CURRENT_DATE + 12 on the DB server's clock; the app
    // counts days on the user's clock. Compute the expected gap the same
    // way the app does instead of assuming the two agree.
    const storedDate = await withDb(async (c) =>
      (await c.query(
        `SELECT o.date::text AS d FROM occasions o
         JOIN users u ON u.id = o.user_id
         WHERE u.email = 'sam@lyco.test' AND o.title = 'Mom''s birthday'`
      )).rows[0].d as string
    );
    const now = new Date();
    const expectedDays = Math.round(
      (Date.parse(`${storedDate}T00:00:00Z`) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
    );
    expect(mom.daysAway).toBe(expectedDays);
    expect(mom.note).toContain("ceramics class");

    // The seeded history spreads across day boundaries; near the start of a
    // month some of it lands in last month. Compare against the same count
    // the app computes rather than assuming all of it is in-month.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const expectedRatio = await withDb(async (c) =>
      (await c.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'done') AS kept, COUNT(*) AS total
         FROM blocks b JOIN users u ON u.id = b.user_id
         WHERE u.email = 'sam@lyco.test' AND scheduled_at >= $1 AND scheduled_at < $2`,
        [monthStart, monthEnd]
      )).rows[0]
    );
    expect(body.total).toBe(parseInt(expectedRatio.total, 10));
    expect(body.kept).toBe(parseInt(expectedRatio.kept, 10));
    await ctx.dispose();
  });
});

// ─── Blocks API: done ────────────────────────────────────────

test.describe.serial("POST /api/blocks/[id]/done", () => {
  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/blocks/00000000-0000-0000-0000-000000000000/done`, { data: {} });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("returns 404 for an unknown block", async () => {
    const ctx = await loginCtx(`done-404-${Date.now()}@lyco.test`);
    const res = await ctx.post(`${BASE}/api/blocks/00000000-0000-0000-0000-000000000000/done`, { data: {} });
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });

  test("marks a scheduled block done, and refuses a second time", async () => {
    const ctx = await loginCtx(`done-twice-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() + 2 * 3600000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 45, title: "Later block" }],
      },
    });
    const { blocks } = await conf.json();
    const id = blocks[0].id;

    const first = await ctx.post(`${BASE}/api/blocks/${id}/done`, { data: {} });
    expect(first.status()).toBe(200);

    const second = await ctx.post(`${BASE}/api/blocks/${id}/done`, { data: {} });
    expect(second.status()).toBe(404);
    await ctx.dispose();
  });
});

// ─── Blocks API: move (all targets) ──────────────────────────

test.describe.serial("POST /api/blocks/[id]/move", () => {
  test("returns 401 without a session", async () => {
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/blocks/00000000-0000-0000-0000-000000000000/move`, {
      data: { target: "drop" },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("returns 400 for missing or unknown targets", async () => {
    const ctx = await loginCtx(`move-bad-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 5 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 30, title: "Movable" }],
      },
    });
    const { blocks } = await conf.json();

    const missing = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, { data: {} });
    expect(missing.status()).toBe(400);

    const invalid = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, { data: { target: "next_year" } });
    expect(invalid.status()).toBe(400);
    await ctx.dispose();
  });

  test("later_today lands at 6:45 pm today or tomorrow in the user's zone", async () => {
    const ctx = await loginCtx(`move-later-${Date.now()}@lyco.test`);
    await ctx.post(`${BASE}/api/user/timezone`, { data: { timezone: "Pacific/Kiritimati" } });
    const start = new Date(Date.now() - 5 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 30, title: "Move me" }],
      },
    });
    const { blocks } = await conf.json();

    const res = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, {
      data: { target: "later_today" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("moved to");

    const stored = await withDb(async (c) =>
      (await c.query(`SELECT scheduled_at FROM blocks WHERE id = $1`, [blocks[0].id])).rows[0].scheduled_at
    );
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati", hour: "numeric", minute: "2-digit", hour12: false,
    }).format(new Date(stored));
    expect(local).toBe("18:45");
    await ctx.dispose();
  });

  test("tomorrow_morning lands at 9:00 am the next day in the user's zone", async () => {
    const ctx = await loginCtx(`move-tom-${Date.now()}@lyco.test`);
    await ctx.post(`${BASE}/api/user/timezone`, { data: { timezone: "Pacific/Kiritimati" } });
    const start = new Date(Date.now() - 5 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 30, title: "Move me too" }],
      },
    });
    const { blocks } = await conf.json();

    const res = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, {
      data: { target: "tomorrow_morning" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("moved to tomorrow");

    const stored = await withDb(async (c) =>
      (await c.query(`SELECT scheduled_at FROM blocks WHERE id = $1`, [blocks[0].id])).rows[0].scheduled_at
    );
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(stored));
    const get = (t: string) => +(parts.find((p) => p.type === t)!.value);
    expect(get("hour")).toBe(9);
    expect(get("minute")).toBe(0);
    const nowParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = new Date(Date.UTC(+nowParts.find((p) => p.type === "year")!.value,
      +nowParts.find((p) => p.type === "month")!.value - 1,
      +nowParts.find((p) => p.type === "day")!.value));
    const storedDay = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
    expect(storedDay.getTime() - today.getTime()).toBe(86400000);
    await ctx.dispose();
  });

  test("drop sets the block status to dropped", async () => {
    const ctx = await loginCtx(`move-drop-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 5 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 30, title: "Drop me" }],
      },
    });
    const { blocks } = await conf.json();

    const res = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, { data: { target: "drop" } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("dropped");

    const status = await withDb(async (c) =>
      (await c.query(`SELECT status FROM blocks WHERE id = $1`, [blocks[0].id])).rows[0].status
    );
    expect(status).toBe("dropped");
    await ctx.dispose();
  });

  test("a done block cannot be moved, extended, or dropped again", async () => {
    const ctx = await loginCtx(`move-done-${Date.now()}@lyco.test`);
    const start = new Date(Date.now() - 5 * 60000);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "G",
        slots: [{ start: start.toISOString(), durationMinutes: 30, title: "Closed" }],
      },
    });
    const { blocks } = await conf.json();
    await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/done`, { data: {} });

    for (const target of ["later_today", "tomorrow_morning", "add_15", "drop"]) {
      const res = await ctx.post(`${BASE}/api/blocks/${blocks[0].id}/move`, { data: { target } });
      expect(res.status(), `move ${target} on a done block`).toBe(404);
    }

    const row = await withDb(async (c) =>
      (await c.query(`SELECT status, duration_minutes FROM blocks WHERE id = $1`, [blocks[0].id])).rows[0]
    );
    expect(row.status).toBe("done");
    expect(row.duration_minutes).toBe(30);
    await ctx.dispose();
  });
});

// ─── Calendar endpoints ──────────────────────────────────────

test.describe.serial("calendar endpoints", () => {
  test("GET /api/calendar/status reflects the stored connection", async () => {
    const ctx = await apiRequest.newContext();
    expect((await ctx.get(`${BASE}/api/calendar/status`)).status()).toBe(401);
    await ctx.dispose();

    const email = `cal-status-${Date.now()}@lyco.test`;
    const auth = await loginCtx(email);
    const uid = await userIdOf(auth);

    let res = await auth.get(`${BASE}/api/calendar/status`);
    expect((await res.json()).connected).toBe(false);

    await setSecret(uid, "google_calendar_refresh_token", "fake-refresh-token");
    res = await auth.get(`${BASE}/api/calendar/status`);
    expect((await res.json()).connected).toBe(true);

    await deleteSecret(uid, "google_calendar_refresh_token");
    await auth.dispose();
  });

  test("GET /api/calendar/connect returns a Google auth URL", async () => {
    const ctx = await apiRequest.newContext();
    expect((await ctx.get(`${BASE}/api/calendar/connect`)).status()).toBe(401);
    await ctx.dispose();

    const auth = await loginCtx(`cal-connect-${Date.now()}@lyco.test`);
    const res = await auth.get(`${BASE}/api/calendar/connect`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.authUrl).toContain("accounts.google.com");
    expect(decodeURIComponent(body.authUrl)).toContain("redirect_uri=http://localhost:3001/api/calendar/callback");
    await auth.dispose();
  });

  test("GET /api/calendar/callback handles every failure path", async () => {
    const anon = await apiRequest.newContext();
    const unauth = await anon.get(`${BASE}/api/calendar/callback?code=x`, { maxRedirects: 0 });
    expect([302, 307]).toContain(unauth.status());
    expect(unauth.headers()["location"]).toContain("error=unauthorized");
    await anon.dispose();

    const auth = await loginCtx(`cal-cb-${Date.now()}@lyco.test`);

    const denied = await auth.get(`${BASE}/api/calendar/callback?error=access_denied`, { maxRedirects: 0 });
    expect(denied.headers()["location"]).toContain("error=access_denied");

    // A callback whose state doesn't match the connect-time cookie is
    // rejected before any code exchange happens.
    const badState = await auth.get(`${BASE}/api/calendar/callback?code=x&state=forged`, { maxRedirects: 0 });
    expect(badState.headers()["location"]).toContain("error=oauth_state");

    // Start a real connect so the context holds a valid state cookie.
    const connect = await auth.get(`${BASE}/api/calendar/connect`);
    const { authUrl } = await connect.json();
    const state = new URL(authUrl).searchParams.get("state")!;

    const noCode = await auth.get(`${BASE}/api/calendar/callback?state=${state}`, { maxRedirects: 0 });
    expect(noCode.headers()["location"]).toContain("error=no_code");

    const badCode = await auth.get(`${BASE}/api/calendar/callback?code=not-a-real-code&state=${state}`, { maxRedirects: 0 });
    expect(badCode.headers()["location"]).toContain("error=oauth_failed");
    await auth.dispose();
  });
});

// ─── Legacy weekday/time slot parsing ────────────────────────

test.describe.serial("POST /api/schedule/confirm legacy slots", () => {
  test("accepts a { day, time } slot and books the next occurrence", async () => {
    const ctx = await loginCtx(`legacy-${Date.now()}@lyco.test`);
    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Legacy",
        slots: [{ day: "Tuesday", time: "7:00 – 8:30 pm", durationMinutes: 90, title: "Evening session" }],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.blocks.length).toBe(1);
    const start = new Date(body.blocks[0].scheduledAt);
    expect(start.getDay()).toBe(2); // Tuesday
    expect(start.getTime()).toBeGreaterThan(Date.now());
    await ctx.dispose();
  });
});

// ─── Tool validation and execution ───────────────────────────
// Drives the tool layer directly — same code the chat route runs —
// against a fresh test user per test.

test.describe.serial("validateToolCall", () => {
  const bad = (name: string, args: Record<string, unknown>) =>
    validateToolCall({ name: name as never, arguments: args });

  test("rejects bad arguments for every tool", () => {
    expect(bad("create_goal", {}).ok).toBe(false);
    expect(bad("create_goal", { title: "x", deadline: "next week" }).ok).toBe(false);
    expect(bad("update_goal", { goal_id: "nope" }).ok).toBe(false);
    expect(bad("update_goal", { goal_id: crypto.randomUUID(), status: "archived" }).ok).toBe(false);
    expect(bad("schedule_block", { title: "x", scheduled_at: "tomorrow", duration_minutes: 60 }).ok).toBe(false);
    expect(bad("schedule_block", { title: "x", scheduled_at: "2030-01-01T10:00", duration_minutes: 4 }).ok).toBe(false);
    expect(bad("schedule_block", { title: "x", scheduled_at: "2030-01-01T10:00", duration_minutes: 481 }).ok).toBe(false);
    expect(bad("complete_block", { block_id: "not-uuid" }).ok).toBe(false);
    expect(bad("move_block", { block_id: crypto.randomUUID(), target: "next_week" }).ok).toBe(false);
    expect(bad("update_block", { block_id: crypto.randomUUID(), title: "  " }).ok).toBe(false);
    expect(bad("create_spending_goal", { label: "eating out", monthly_amount: -5 }).ok).toBe(false);
    expect(bad("log_spending", { spending_goal_label: "x", amount: 0 }).ok).toBe(false);
    expect(bad("log_spending", { spending_goal_label: "x", amount: 5, date: "yesterday" }).ok).toBe(false);
    expect(bad("add_occasion", { title: "x", date: "March 3" }).ok).toBe(false);
    expect(bad("nonexistent_tool", {}).ok).toBe(false);
  });

  test("accepts well-formed arguments", () => {
    const ok = (name: string, args: Record<string, unknown>) =>
      validateToolCall({ name: name as never, arguments: args });
    expect(ok("create_goal", { title: "Run a 5k" }).ok).toBe(true);
    expect(ok("create_goal", { title: "Run a 5k", deadline: "2030-01-01", cadence: "2x a week" }).ok).toBe(true);
    expect(ok("update_goal", { goal_id: crypto.randomUUID(), status: "paused" }).ok).toBe(true);
    expect(ok("update_goal", { goal_id: crypto.randomUUID(), deadline: null }).ok).toBe(true);
    expect(ok("schedule_block", { title: "x", scheduled_at: "2030-01-01T10:00", duration_minutes: 90 }).ok).toBe(true);
    expect(ok("complete_block", { block_id: crypto.randomUUID() }).ok).toBe(true);
    expect(ok("move_block", { block_id: crypto.randomUUID(), target: "drop" }).ok).toBe(true);
    expect(ok("update_block", { block_id: crypto.randomUUID(), title: "new title" }).ok).toBe(true);
    expect(ok("create_spending_goal", { label: "groceries", monthly_amount: 300 }).ok).toBe(true);
    expect(ok("log_spending", { spending_goal_label: "groceries", amount: 12.5 }).ok).toBe(true);
    expect(ok("add_occasion", { title: "trip", date: "2030-06-01" }).ok).toBe(true);
  });
});

test.describe.serial("executeTools", () => {
  test("goal lifecycle: create, update, pause, complete", async () => {
    const ctx = await loginCtx(`tools-goal-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const created = await executeTools(
      [{ name: "create_goal", arguments: { title: "Tool goal", deadline: "2030-01-15", cadence: "weekly" } }],
      uid
    );
    expect(created.results[0].success).toBe(true);
    const goalId = created.results[0].data!.goal_id as string;
    expect(created.rowChanges[0].table).toBe("goals");

    const updated = await executeTools(
      [{ name: "update_goal", arguments: { goal_id: goalId, title: "Renamed goal", cadence: "2x a week" } }],
      uid
    );
    expect(updated.results[0].success).toBe(true);

    const row = await withDb(async (c) =>
      (await c.query(`SELECT title, cadence FROM goals WHERE id = $1`, [goalId])).rows[0]
    );
    expect(row.title).toBe("Renamed goal");
    expect(row.cadence).toBe("2x a week");

    const paused = await executeTools(
      [{ name: "update_goal", arguments: { goal_id: goalId, status: "paused" } }],
      uid
    );
    expect(paused.results[0].success).toBe(true);

    const done = await executeTools(
      [{ name: "update_goal", arguments: { goal_id: goalId, status: "done" } }],
      uid
    );
    expect(done.results[0].success).toBe(true);

    const noFields = await executeTools(
      [{ name: "update_goal", arguments: { goal_id: goalId } }],
      uid
    );
    expect(noFields.results[0].success).toBe(false);
    expect(noFields.results[0].message).toContain("No fields");

    const foreign = await executeTools(
      [{ name: "update_goal", arguments: { goal_id: crypto.randomUUID(), title: "nope" } }],
      uid
    );
    expect(foreign.results[0].success).toBe(false);
    await ctx.dispose();
  });

  test("block lifecycle via tools: schedule, rename, extend, complete", async () => {
    const ctx = await loginCtx(`tools-block-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const sched = await executeTools(
      [{
        name: "schedule_block",
        arguments: {
          title: "Tool block",
          scheduled_at: new Date(Date.now() - 5 * 60000).toISOString(),
          duration_minutes: 60,
        },
      }],
      uid
    );
    expect(sched.results[0].success).toBe(true);
    const blockId = sched.results[0].data!.block_id as string;

    const renamed = await executeTools(
      [{ name: "update_block", arguments: { block_id: blockId, title: "Better first step" } }],
      uid
    );
    expect(renamed.results[0].success).toBe(true);

    const extended = await executeTools(
      [{ name: "move_block", arguments: { block_id: blockId, target: "add_15" } }],
      uid
    );
    expect(extended.results[0].success).toBe(true);
    const row = await withDb(async (c) =>
      (await c.query(`SELECT duration_minutes FROM blocks WHERE id = $1`, [blockId])).rows[0]
    );
    expect(row.duration_minutes).toBe(75);

    const completed = await executeTools(
      [{ name: "complete_block", arguments: { block_id: blockId } }],
      uid
    );
    expect(completed.results[0].success).toBe(true);

    // Closed blocks refuse further tool changes
    const again = await executeTools(
      [{ name: "complete_block", arguments: { block_id: blockId } }],
      uid
    );
    expect(again.results[0].success).toBe(false);
    const renamedClosed = await executeTools(
      [{ name: "update_block", arguments: { block_id: blockId, title: "too late" } }],
      uid
    );
    expect(renamedClosed.results[0].success).toBe(false);
    const movedClosed = await executeTools(
      [{ name: "move_block", arguments: { block_id: blockId, target: "drop" } }],
      uid
    );
    expect(movedClosed.results[0].success).toBe(false);
    await ctx.dispose();
  });

  test("move_block later_today and tomorrow_morning reschedule the block", async () => {
    const ctx = await loginCtx(`tools-move-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const sched = await executeTools(
      [{
        name: "schedule_block",
        arguments: {
          title: "Reschedulable",
          scheduled_at: new Date(Date.now() - 5 * 60000).toISOString(),
          duration_minutes: 45,
        },
      }],
      uid
    );
    const blockId = sched.results[0].data!.block_id as string;

    const later = await executeTools(
      [{ name: "move_block", arguments: { block_id: blockId, target: "later_today" } }],
      uid
    );
    expect(later.results[0].success).toBe(true);
    let stored = await withDb(async (c) =>
      new Date((await c.query(`SELECT scheduled_at FROM blocks WHERE id = $1`, [blockId])).rows[0].scheduled_at)
    );
    expect(stored.getTime()).toBeGreaterThan(Date.now());

    const tomorrow = await executeTools(
      [{ name: "move_block", arguments: { block_id: blockId, target: "tomorrow_morning" } }],
      uid
    );
    expect(tomorrow.results[0].success).toBe(true);
    stored = await withDb(async (c) =>
      new Date((await c.query(`SELECT scheduled_at FROM blocks WHERE id = $1`, [blockId])).rows[0].scheduled_at)
    );
    expect(stored.getTime()).toBeGreaterThan(Date.now() + 3600000);

    const dropped = await executeTools(
      [{ name: "move_block", arguments: { block_id: blockId, target: "drop" } }],
      uid
    );
    expect(dropped.results[0].success).toBe(true);
    const status = await withDb(async (c) =>
      (await c.query(`SELECT status FROM blocks WHERE id = $1`, [blockId])).rows[0].status
    );
    expect(status).toBe("dropped");
    await ctx.dispose();
  });

  test("spending tools: target creation, dedupe, and logging", async () => {
    const ctx = await loginCtx(`tools-spend-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const created = await executeTools(
      [{ name: "create_spending_goal", arguments: { label: "coffee", monthly_amount: 50 } }],
      uid
    );
    expect(created.results[0].success).toBe(true);
    const sgId = created.results[0].data!.spending_goal_id as string;
    const cents = await withDb(async (c) =>
      (await c.query(`SELECT budget_cents FROM spending_goals WHERE id = $1`, [sgId])).rows[0].budget_cents
    );
    expect(cents).toBe(5000);

    // Same label, different case — returns the existing target, no duplicate
    const dupe = await executeTools(
      [{ name: "create_spending_goal", arguments: { label: "Coffee", monthly_amount: 999 } }],
      uid
    );
    expect(dupe.results[0].success).toBe(true);
    expect(dupe.results[0].data!.spending_goal_id).toBe(sgId);
    const count = await withDb(async (c) =>
      (await c.query(`SELECT COUNT(*) AS n FROM spending_goals WHERE user_id = $1`, [uid])).rows[0].n
    );
    expect(parseInt(count, 10)).toBe(1);

    const logged = await executeTools(
      [{ name: "log_spending", arguments: { spending_goal_label: "COFFEE", amount: 4.75, description: "latte" } }],
      uid
    );
    expect(logged.results[0].success).toBe(true);
    const entry = await withDb(async (c) =>
      (await c.query(`SELECT amount_cents, spent_at FROM spending_entries WHERE user_id = $1`, [uid])).rows[0]
    );
    expect(entry.amount_cents).toBe(475);

    // Logging with an explicit date lands on that date
    const dated = await executeTools(
      [{ name: "log_spending", arguments: { spending_goal_label: "coffee", amount: 10, date: "2020-06-15" } }],
      uid
    );
    expect(dated.results[0].success).toBe(true);

    // Unknown target → helpful error naming the real ones
    const unknown = await executeTools(
      [{ name: "log_spending", arguments: { spending_goal_label: "yachts", amount: 5 } }],
      uid
    );
    expect(unknown.results[0].success).toBe(false);
    expect(unknown.results[0].message).toContain("coffee");
    await ctx.dispose();
  });

  test("add_occasion stores the date and note", async () => {
    const ctx = await loginCtx(`tools-occ-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const res = await executeTools(
      [{ name: "add_occasion", arguments: { title: "Anniversary", date: "2030-04-24", note: "book dinner" } }],
      uid
    );
    expect(res.results[0].success).toBe(true);

    const row = await withDb(async (c) =>
      (await c.query(`SELECT title, note FROM occasions WHERE user_id = $1`, [uid])).rows[0]
    );
    expect(row.title).toBe("Anniversary");
    expect(row.note).toBe("book dinner");
    await ctx.dispose();
  });

  test("invalid calls report failure instead of throwing", async () => {
    const ctx = await loginCtx(`tools-bad-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const res = await executeTools(
      [
        { name: "create_goal", arguments: { title: "" } },
        { name: "complete_block", arguments: { block_id: "not-a-uuid" } },
      ],
      uid
    );
    expect(res.results).toHaveLength(2);
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].message).toContain("Validation failed");
    expect(res.results[1].success).toBe(false);
    await ctx.dispose();
  });
});

// ─── Reminder sweep: 1-day occasion heads-up ─────────────────

test.describe.serial("reminder sweep: 1-day occasion", () => {
  test("an occasion tomorrow sends one heads-up, once", async () => {
    const email = `remind-1day-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    await ctx.post(`${BASE}/api/user/timezone`, { data: { timezone: "Pacific/Kiritimati" } });
    const me = await (await ctx.get(`${BASE}/api/auth/me`)).json();

    // Noon in Kiritimati; the occasion is "tomorrow" in that zone
    const kiritimatiNoon = new Date();
    kiritimatiNoon.setUTCHours(22, 0, 0, 0);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(kiritimatiNoon);
    const y = +(parts.find((p) => p.type === "year")!.value);
    const m = +(parts.find((p) => p.type === "month")!.value);
    const dd = +(parts.find((p) => p.type === "day")!.value);
    const occasionDate = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);

    await withDb(async (c) => {
      await c.query(
        `INSERT INTO occasions (user_id, title, date) VALUES ($1, $2, $3)`,
        [me.user.id, "Tomorrow thing", occasionDate]
      );
    });

    const sent = runRemind({ only: email, at: kiritimatiNoon });
    expect(sent.filter((r) => r.kind === "occasion" && r.title === "Tomorrow thing")).toHaveLength(1);

    // Same sweep again → the reminder row dedupes it
    const again = runRemind({ only: email, at: kiritimatiNoon });
    expect(again.filter((r) => r.title === "Tomorrow thing")).toHaveLength(0);
    await ctx.dispose();
  });
});

// ─── Model choice ────────────────────────────────────────────

test.describe.serial("model choice", () => {
  test("GET /api/user/model returns the lineup and the default", async () => {
    const anon = await apiRequest.newContext();
    expect((await anon.get(`${BASE}/api/user/model`)).status()).toBe(401);
    await anon.dispose();

    const ctx = await loginCtx(`model-${Date.now()}@lyco.test`);
    const res = await ctx.get(`${BASE}/api/user/model`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.models).toHaveLength(3);
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      "claude-sonnet-5", "claude-opus-5", "claude-haiku-5-5",
    ]);
    await ctx.dispose();
  });

  test("POST /api/user/model validates, stores, and can reset", async () => {
    const ctx = await loginCtx(`model-set-${Date.now()}@lyco.test`);

    for (const model of ["gpt-4", "claude-fake", 42, null + "x", ""]) {
      const res = await ctx.post(`${BASE}/api/user/model`, { data: { model } });
      expect(res.status(), String(model)).toBe(400);
    }

    const ok = await ctx.post(`${BASE}/api/user/model`, { data: { model: "claude-opus-5" } });
    expect(ok.status()).toBe(200);
    await expect((await ctx.get(`${BASE}/api/user/model`)).json()).resolves.toMatchObject({ model: "claude-opus-5" });

    const stored = await withDb(async (c) =>
      (await c.query(
        `SELECT preferred_model FROM users WHERE email LIKE 'model-set-%@lyco.test' ORDER BY created_at DESC LIMIT 1`
      )).rows[0].preferred_model
    );
    expect(stored).toBe("claude-opus-5");

    const reset = await ctx.post(`${BASE}/api/user/model`, { data: { model: "default" } });
    expect(reset.status()).toBe(200);
    await expect((await ctx.get(`${BASE}/api/user/model`)).json()).resolves.toMatchObject({ model: "claude-sonnet-5" });
    await ctx.dispose();
  });

  test("chat uses the user's chosen model and logs it", async () => {
    const email = `model-chat-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    await ctx.post(`${BASE}/api/user/model`, { data: { model: "claude-haiku-5-5" } });

    const res = await ctx.post(`${BASE}/api/chat`, {
      data: { messages: [{ role: "user", content: "Just say hi." }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).model).toBe("claude-haiku-5-5");

    const logged = await withDb(async (c) =>
      (await c.query(
        `SELECT model FROM llm_interactions
         WHERE user_id = (SELECT id FROM users WHERE email = $1)
         ORDER BY created_at DESC LIMIT 1`, [email]
      )).rows[0].model
    );
    expect(logged).toBe("claude-haiku-5-5");
    await ctx.dispose();
  });

  test("a broken preferred model falls back to the lineup", async () => {
    const ctx = await loginCtx(`model-fallback-${Date.now()}@lyco.test`);
    const me = await (await ctx.get(`${BASE}/api/auth/me`)).json();

    // Preferred model id that does not exist — callLLM should slide to
    // the next working model instead of erroring.
    const { callLLM } = await import("../src/lib/llm");
    const res = await callLLM(
      [{ role: "user", content: "Just say hi." }],
      me.user.id,
      undefined,
      "claude-nonexistent-9"
    );
    expect(res.model).toBe("claude-sonnet-5");
    expect(res.text.length).toBeGreaterThan(0);
    await ctx.dispose();
  });
});

// ─── Attachments + goal/block notes ──────────────────────────

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.describe.serial("chat attachments and notes", () => {
  test("validateAttachment accepts the supported types and rejects the rest", async () => {
    const { validateAttachment } = await import("../src/lib/attachments");

    const good = [
      { name: "photo.png", mediaType: "image/png", kind: "image", data: PNG_1PX, sizeBytes: 70 },
      { name: "scan.pdf", mediaType: "application/pdf", kind: "pdf", data: "JVBERi0xLjQK", sizeBytes: 10 },
      { name: "spending.csv", mediaType: "text/csv", kind: "text", data: "date,amount\n1,2", sizeBytes: 15 },
      // extension fallback when the mime type is vague
      { name: "notes.txt", mediaType: "application/octet-stream", kind: "text", data: "hi", sizeBytes: 2 },
    ];
    for (const att of good) {
      expect(validateAttachment(att).ok, att.name).toBe(true);
    }

    const bad = [
      // unsupported type
      { name: "run.exe", mediaType: "application/x-msdownload", kind: "text", data: "abc", sizeBytes: 3 },
      { name: "page.html", mediaType: "text/html", kind: "text", data: "<b>x</b>", sizeBytes: 8 },
      // oversized file
      { name: "big.png", mediaType: "image/png", kind: "image", data: PNG_1PX, sizeBytes: 6 * 1024 * 1024 },
      // invalid base64 for a binary kind
      { name: "bad.png", mediaType: "image/png", kind: "image", data: "!!!not base64!!!", sizeBytes: 10 },
      // missing pieces
      { name: "no-data.png", mediaType: "image/png", kind: "image", data: "", sizeBytes: 0 },
      { mediaType: "image/png", kind: "image", data: PNG_1PX, sizeBytes: 70 },
      null,
      "a string",
    ];
    for (const att of bad) {
      expect(validateAttachment(att).ok, JSON.stringify(att).slice(0, 60)).toBe(false);
    }
  });

  test("notes save on goals and blocks and surface on home and block", async () => {
    const email = `notes-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    const userId = await userIdOf(ctx);

    const created = await executeTools(
      [{ name: "create_goal", arguments: { title: "Kitchen reno", note: "Quote #4417 from Northwood." } }],
      userId
    );
    expect(created.results[0].success).toBe(true);
    const goalId = created.results[0].data?.goal_id as string;

    const start = new Date(Date.now() - 5 * 60000).toISOString();
    const sched = await executeTools(
      [{ name: "schedule_block", arguments: {
          title: "Compare counter quotes",
          scheduled_at: start,
          duration_minutes: 60,
          goal_id: goalId,
          note: "Northwood $4,120 vs Rona $3,890.",
        } }],
      userId
    );
    expect(sched.results[0].success).toBe(true);
    const blockId = sched.results[0].data?.block_id as string;

    // A block note beats the goal note; update_block can set it alone.
    const upd = await executeTools(
      [{ name: "update_block", arguments: { block_id: blockId, note: "Ask about install dates first." } }],
      userId
    );
    expect(upd.results[0].success).toBe(true);
    expect(upd.results[0].data?.note).toBe("Ask about install dates first.");

    const current = await (await ctx.get(`${BASE}/api/blocks/current`)).json();
    expect(current.block.note).toBe("Ask about install dates first.");

    const home = await (await ctx.get(`${BASE}/api/home`)).json();
    expect(home.currentBlock.note).toBe("Ask about install dates first.");

    const goalUpd = await executeTools(
      [{ name: "update_goal", arguments: { goal_id: goalId, note: "Final decision Friday." } }],
      userId
    );
    expect(goalUpd.results[0].success).toBe(true);
    const stored = await withDb(async (c) =>
      (await c.query(`SELECT note FROM goals WHERE id = $1`, [goalId])).rows[0].note
    );
    expect(stored).toBe("Final decision Friday.");
    await ctx.dispose();
  });

  test("chat accepts a text attachment and logs only its metadata", async () => {
    const email = `attach-${Date.now()}@lyco.test`;
    const ctx = await loginCtx(email);
    const userId = await userIdOf(ctx);

    const csv = "date,item,amount\n2025-01-05,coffee,4.50";
    const res = await ctx.post(`${BASE}/api/chat`, {
      data: {
        messages: [{
          role: "user",
          content: "In one short sentence, what does this file list?",
          attachments: [
            { name: "spending.csv", mediaType: "text/csv", kind: "text", data: csv, sizeBytes: csv.length },
          ],
        }],
      },
    });
    expect(res.status()).toBe(200);

    // The file itself must never land in the interaction log — only
    // its name, type, and size.
    const logged = await withDb(async (c) =>
      (await c.query(
        `SELECT prompt FROM llm_interactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      )).rows[0].prompt
    );
    const msgs = typeof logged === "string" ? JSON.parse(logged) : logged;
    const att = msgs[0].attachments[0];
    expect(att.name).toBe("spending.csv");
    expect(att.mediaType).toBe("text/plain");
    expect(att.sizeBytes).toBe(csv.length);
    expect(att.data).toBeUndefined();
    await ctx.dispose();
  });
});

// ─── Side chat ───────────────────────────────────────────────
// A side question rides on the main conversation as read-only
// background and is logged with session_id = 'side'.

test.describe.serial("side chat", () => {
  test.setTimeout(90000);

  test("answers using the main conversation as background and logs 'side'", async () => {
    const ctx = await loginCtx(`side-${Date.now()}@lyco.test`);
    const uid = await userIdOf(ctx);

    const res = await ctx.post(`${BASE}/api/chat`, {
      data: {
        sideChat: true,
        mainMessages: [
          { role: "user", content: "I want to learn the banjo" },
          { role: "assistant", content: "When do you want to be able to play your first song?" },
          // Attachment-only main turns are valid background context
          { role: "user", content: "", attachments: [{ name: "chords.pdf" }] },
        ],
        messages: [
          { role: "user", content: "What instrument did I just say I want to learn? Answer with the instrument name only." },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.text.toLowerCase()).toContain("banjo");

    const logged = await withDb(async (c) =>
      (await c.query(
        `SELECT session_id FROM llm_interactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [uid]
      )).rows[0].session_id
    );
    expect(logged).toBe("side");
    await ctx.dispose();
  });

  test("rejects malformed mainMessages without calling the model", async () => {
    const ctx = await loginCtx(`side-bad-${Date.now()}@lyco.test`);
    const invalids: unknown[] = [
      "not-an-array",
      [{ role: "user", content: "" }],
      [{ role: "user" }],
      [{ role: "user", content: 42 }],
      ["plain string"],
    ];
    for (const mainMessages of invalids) {
      const res = await ctx.post(`${BASE}/api/chat`, {
        data: {
          sideChat: true,
          mainMessages,
          messages: [{ role: "user", content: "hi" }],
        },
      });
      expect(res.status(), JSON.stringify(mainMessages)).toBe(400);
    }
    await ctx.dispose();
  });
});

// ─── Chat replyTo (quote-a-sentence replies) ─────────────────
// replyTo carries the quoted sentence or paragraph a user message is
// replying to. It must be a non-empty string within bounds.

test.describe.serial("chat replyTo", () => {
  test("rejects malformed replyTo values with a 400", async () => {
    const ctx = await loginCtx(`replyto-bad-${Date.now()}@lyco.test`);
    const badValues: unknown[] = [
      123,
      { quote: "x" },
      ["x"],
      "",
      "   ",
      "x".repeat(2001),
      true,
    ];
    for (const replyTo of badValues) {
      const res = await ctx.post(`${BASE}/api/chat`, {
        data: {
          messages: [{ role: "user", content: "my reply", replyTo }],
        },
      });
      expect(res.status(), JSON.stringify(replyTo).slice(0, 60)).toBe(400);
    }
    await ctx.dispose();
  });

  test("rejects a non-string replyTo in mainMessages", async () => {
    const ctx = await loginCtx(`replyto-main-${Date.now()}@lyco.test`);
    const res = await ctx.post(`${BASE}/api/chat`, {
      data: {
        sideChat: true,
        mainMessages: [{ role: "user", content: "hi", replyTo: 42 }],
        messages: [{ role: "user", content: "follow up" }],
      },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test("a valid replyTo is accepted and the quote reaches the model", async () => {
    const ctx = await loginCtx(`replyto-ok-${Date.now()}@lyco.test`);
    const res = await ctx.post(`${BASE}/api/chat`, {
      data: {
        messages: [
          { role: "assistant", content: "Try out the brass section first. Or maybe the woodwinds." },
          {
            role: "user",
            content: "Which section did you suggest first? Answer with the section name only.",
            replyTo: "Try out the brass section first.",
          },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.text.toLowerCase()).toContain("brass");
    await ctx.dispose();
  });
});
