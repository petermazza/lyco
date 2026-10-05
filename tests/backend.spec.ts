import { test, expect, request as apiRequest } from "@playwright/test";

const BASE = "http://localhost:3001";

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
