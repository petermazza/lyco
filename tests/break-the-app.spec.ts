import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import crypto from "crypto";
import pg from "pg";
import { createMagicLink } from "../src/lib/auth";
import { executeTools } from "../src/lib/tool-executor";

const BASE = "http://localhost:3001";

function envVar(name: string): string {
  const env = readFileSync(".env.local", "utf-8");
  const match = env.match(new RegExp(`^${name}=["']?(.+?)["']?\\s*$`, "m"));
  return match ? match[1] : "";
}
const testDbUrl = () => envVar("TEST_DATABASE_URL") || envVar("DATABASE_URL");
process.env.DATABASE_URL ||= testDbUrl();
process.env.AUTH_SECRET ||= envVar("AUTH_SECRET") || "dev-secret";

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Full sign-in through the real magic-link flow — same helper as the
// other specs, duplicated so each file is self-contained.
async function loginCtx(email: string) {
  const ctx = await apiRequest.newContext();
  const res = await ctx.post(`${BASE}/api/auth/request-link`, { data: { email } });
  const body = await res.json();
  await ctx.get(body.link);
  return ctx;
}

const uniq = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@lyco.test`;

async function makeBlock(ctx: Awaited<ReturnType<typeof apiRequest.newContext>>, title = "Race block", minutesAgo = 5) {
  const start = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
    data: { goalTitle: "G", slots: [{ start, durationMinutes: 30, title }] },
  });
  const body = await conf.json();
  return body.blocks[0].id as string;
}

// Every adversarial request must produce a controlled client response —
// never an unhandled 500.
function expectNotServerError(status: number) {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
}

// ─── Malformed JSON and bodies ───────────────────────────────

test.describe.serial("malformed request bodies", () => {
  test("non-JSON bodies get a 400, not a crash", async () => {
    const ctx = await loginCtx(uniq("badjson"));

    for (const path of [
      "/api/auth/request-link",
      "/api/chat",
      "/api/schedule/confirm",
      "/api/user/timezone",
    ]) {
      const res = await ctx.post(`${BASE}${path}`, {
        data: "{ this is not json",
        headers: { "Content-Type": "application/json" },
      });
      expectNotServerError(res.status());
    }
    await ctx.dispose();
  });

  test("request-link rejects non-string emails", async () => {
    const ctx = await apiRequest.newContext();
    for (const email of [123, { a: 1 }, ["x@y.co"], null, true]) {
      const res = await ctx.post(`${BASE}/api/auth/request-link`, { data: { email } });
      expect(res.status()).toBe(400);
    }
    await ctx.dispose();
  });

  test("request-link rejects injection-looking and malformed emails", async () => {
    const ctx = await apiRequest.newContext();
    for (const email of ["", "   ", "not-an-email", "' OR '1'='1", "a b@c.co", "a@b", "a@@b.co"]) {
      const res = await ctx.post(`${BASE}/api/auth/request-link`, { data: { email } });
      expect(res.status()).toBe(400);
    }
    await ctx.dispose();
  });

  test("chat rejects every malformed messages shape", async () => {
    const ctx = await loginCtx(uniq("badchat"));
    const badBodies = [
      {},
      { messages: [] },
      { messages: "hi" },
      { messages: 42 },
      { messages: [null] },
      { messages: ["hello"] },
      { messages: [{ role: "user" }] },
      { messages: [{ role: "user", content: "" }] },
      { messages: [{ role: "user", content: "   " }] },
      { messages: [{ role: "user", content: 123 }] },
    ];
    for (const data of badBodies) {
      const res = await ctx.post(`${BASE}/api/chat`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
    await ctx.dispose();
  });

  test("timezone rejects bad values", async () => {
    const ctx = await loginCtx(uniq("badtz"));
    for (const timezone of ["Mars/Olympus", "../../etc/passwd", 5, null, {}]) {
      const res = await ctx.post(`${BASE}/api/user/timezone`, { data: { timezone } });
      expect(res.status()).toBe(400);
    }
    await ctx.dispose();
  });

  test("confirm rejects malformed slots without touching the database", async () => {
    const email = uniq("badslots");
    const ctx = await loginCtx(email);

    const badBodies: unknown[] = [
      { goalTitle: "G", slots: "not-an-array" },
      { goalTitle: "G", slots: [] },
      { goalTitle: "G", slots: [null] },
      { goalTitle: "G", slots: [42] },
      { goalTitle: "G", slots: [{}] },
      { goalTitle: "G", slots: [{ title: "  " }] },
      { goalTitle: "G", slots: [{ title: "x", start: "not-a-date", durationMinutes: 60 }] },
      { goalTitle: "G", slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: -30 }] },
      { goalTitle: "G", slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: 0 }] },
      { goalTitle: "G", slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: "sixty" }] },
      { goalTitle: "G", slots: [{ title: "x", day: 5, time: "7:00 pm" }] },
      { goalTitle: "G", slots: [{ title: "x", day: "Tuesday", time: 700 }] },
      { goalTitle: "G", slots: [{ title: "x", start: 5, durationMinutes: 30 }] },
      { slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: 30 }] },
      { goalTitle: 42, slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: 30 }] },
    ];

    for (const data of badBodies) {
      const res = await ctx.post(`${BASE}/api/schedule/confirm`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }

    // Nothing slipped through into storage
    const count = await withDb(async (c) =>
      (await c.query(
        `SELECT COUNT(*) AS n FROM blocks b JOIN users u ON u.id = b.user_id WHERE u.email = $1`,
        [email]
      )).rows[0].n
    );
    expect(parseInt(count, 10)).toBe(0);
    await ctx.dispose();
  });

  test("a confirm where only some slots are valid creates just the good ones", async () => {
    const ctx = await loginCtx(uniq("mixedslots"));
    const good = new Date(Date.now() + 4 * 3600000).toISOString();
    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Mixed",
        slots: [
          { title: "Good one", start: good, durationMinutes: 30 },
          { title: "", start: good, durationMinutes: 30 },
          null,
          { title: "Bad time", start: "garbage", durationMinutes: 30 },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].title).toBe("Good one");
    expect(body.errors.length).toBe(3);
    await ctx.dispose();
  });

  test("chat rejects malformed attachments with a 400", async () => {
    const ctx = await loginCtx(uniq("badattach"));
    const text = "date,amount\n1,2";
    const validAtt = { name: "ok.csv", mediaType: "text/csv", kind: "text", data: text, sizeBytes: text.length };

    const badBodies: unknown[] = [
      // more than 3 attachments on one message
      { messages: [{ role: "user", attachments: [validAtt, validAtt, validAtt, validAtt] }] },
      // executable / unsupported types
      { messages: [{ role: "user", attachments: [{ name: "run.exe", mediaType: "application/x-msdownload", kind: "text", data: "abc", sizeBytes: 3 }] }] },
      { messages: [{ role: "user", attachments: [{ name: "page.html", mediaType: "text/html", kind: "text", data: "<b>x</b>", sizeBytes: 8 }] }] },
      // claims to be over 5 mb
      { messages: [{ role: "user", attachments: [{ name: "big.png", mediaType: "image/png", kind: "image", data: "AAAA", sizeBytes: 6 * 1024 * 1024 }] }] },
      // invalid base64 for a binary kind
      { messages: [{ role: "user", attachments: [{ name: "bad.png", mediaType: "image/png", kind: "image", data: "!!!not base64!!!", sizeBytes: 10 }] }] },
      // attachment that isn't an object
      { messages: [{ role: "user", attachments: ["file.png"] }] },
      { messages: [{ role: "user", attachments: [null] }] },
      // attachments that aren't an array
      { messages: [{ role: "user", content: "hi", attachments: "ok.csv" }] },
      // neither text nor attachment
      { messages: [{ role: "user", content: "", attachments: [] }] },
    ];

    for (const data of badBodies) {
      const res = await ctx.post(`${BASE}/api/chat`, { data });
      expect(res.status(), JSON.stringify(data).slice(0, 120)).toBe(400);
    }
    await ctx.dispose();
  });
});

// ─── Malformed path values ───────────────────────────────────

test.describe.serial("malformed path and query values", () => {
  test("non-UUID block ids get a 404, never a 500", async () => {
    const ctx = await loginCtx(uniq("baduuid"));
    for (const id of ["not-a-uuid", "123", "' OR 1=1--", "null", crypto.randomUUID() + "extra"]) {
      const done = await ctx.post(`${BASE}/api/blocks/${encodeURIComponent(id)}/done`, { data: {} });
      expect(done.status(), `done ${id}`).toBe(404);

      const move = await ctx.post(`${BASE}/api/blocks/${encodeURIComponent(id)}/move`, { data: { target: "drop" } });
      expect(move.status(), `move ${id}`).toBe(404);

      const rename = await ctx.patch(`${BASE}/api/blocks/${encodeURIComponent(id)}`, { data: { title: "x" } });
      expect(rename.status(), `rename ${id}`).toBe(404);
    }
    await ctx.dispose();
  });

  test("non-UUID goal ids get a 404 on proposal and confirm", async () => {
    const ctx = await loginCtx(uniq("badgoal"));
    const prop = await ctx.get(`${BASE}/api/schedule/proposal?goalId=not-a-uuid`);
    expect(prop.status()).toBe(404);
    const conf = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalId: "not-a-uuid",
        goalTitle: "G",
        slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: 30 }],
      },
    });
    expect(conf.status()).toBe(404);
    await ctx.dispose();
  });
});

// ─── Token tampering and expiry ──────────────────────────────

test.describe.serial("token tampering and expiry", () => {
  test("a forged session cookie is rejected everywhere", async () => {
    const ctx = await apiRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Cookie: `lyco_session=${crypto.randomBytes(32).toString("hex")}` },
    });
    for (const path of ["/api/home", "/api/blocks/current", "/api/calendar/status", "/api/schedule/proposal"]) {
      const res = await ctx.get(path);
      expect(res.status(), path).toBe(401);
    }
    const post = await ctx.post(`${BASE}/api/chat`, {
      data: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(post.status()).toBe(401);
    await ctx.dispose();
  });

  test("a truncated real session cookie is rejected", async () => {
    const good = await loginCtx(uniq("trunc"));
    const state = await good.storageState();
    const cookie = state.cookies.find((c) => c.name === "lyco_session");
    expect(cookie).toBeTruthy();
    await good.dispose();

    const forged = await apiRequest.newContext({
      storageState: {
        cookies: [{ ...cookie!, value: cookie!.value.slice(0, 12) }],
        origins: [],
      },
    });
    const res = await forged.get(`${BASE}/api/home`);
    expect(res.status()).toBe(401);
    await forged.dispose();
  });

  test("an expired session is rejected", async () => {
    const ctx = await loginCtx(uniq("expired"));
    const state = await ctx.storageState();
    const cookie = state.cookies.find((c) => c.name === "lyco_session")!;

    // Age the session past its lifetime
    const tokenHash = crypto
      .createHmac("sha256", envVar("AUTH_SECRET") || "dev-secret")
      .update(cookie.value)
      .digest("hex");
    await withDb((c) =>
      c.query(`UPDATE sessions SET expires_at = now() - interval '1 day' WHERE token_hash = $1`, [tokenHash])
    );

    const res = await ctx.get(`${BASE}/api/home`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("an expired magic link is rejected", async () => {
    const email = uniq("oldlink");
    const { token } = await createMagicLink(email);
    await withDb((c) =>
      c.query(`UPDATE magic_link_tokens SET expires_at = now() - interval '1 hour' WHERE email = $1`, [email])
    );
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(`${BASE}/api/auth/verify?token=${token}`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("a used magic link cannot be replayed", async () => {
    const email = uniq("replay");
    const first = await apiRequest.newContext();
    const res = await first.post(`${BASE}/api/auth/request-link`, { data: { email } });
    const { link } = await res.json();

    // First use signs in
    await first.get(link);
    const me = await (await first.get(`${BASE}/api/auth/me`)).json();
    expect(me.user.email).toBe(email);

    // Second use is refused
    const second = await apiRequest.newContext();
    const again = await second.get(link, { maxRedirects: 0 });
    expect(again.status()).toBe(401);
    const me2 = await second.get(`${BASE}/api/auth/me`);
    expect((await me2.json()).user).toBeNull();
    await first.dispose();
    await second.dispose();
  });
});

// ─── Cross-user isolation ────────────────────────────────────

test.describe.serial("cross-user isolation", () => {
  test("user B cannot touch user A's blocks or goals", async () => {
    const ctxA = await loginCtx(uniq("alice"));
    const ctxB = await loginCtx(uniq("bob"));

    const blockId = await makeBlock(ctxA, "Alice's block");
    const meA = await (await ctxA.get(`${BASE}/api/auth/me`)).json();
    const goal = await executeTools(
      [{ name: "create_goal", arguments: { title: "Alice's goal" } }],
      meA.user.id
    );
    const goalId = goal.results[0].data!.goal_id as string;

    for (const attempt of [
      () => ctxB.post(`${BASE}/api/blocks/${blockId}/done`, { data: {} }),
      () => ctxB.post(`${BASE}/api/blocks/${blockId}/move`, { data: { target: "drop" } }),
      () => ctxB.patch(`${BASE}/api/blocks/${blockId}`, { data: { title: "hijacked" } }),
    ]) {
      const res = await attempt();
      expect(res.status()).toBe(404);
    }

    const prop = await ctxB.get(`${BASE}/api/schedule/proposal?goalId=${goalId}`);
    expect(prop.status()).toBe(404);
    const conf = await ctxB.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalId,
        goalTitle: "Hijack",
        slots: [{ title: "x", start: new Date().toISOString(), durationMinutes: 30 }],
      },
    });
    expect(conf.status()).toBe(404);

    // A's block is untouched
    const row = await withDb(async (c) =>
      (await c.query(`SELECT title, status FROM blocks WHERE id = $1`, [blockId])).rows[0]
    );
    expect(row.title).toBe("Alice's block");
    expect(row.status).not.toBe("done");
    expect(row.status).not.toBe("dropped");
    await ctxA.dispose();
    await ctxB.dispose();
  });

  test("user B's home never lists user A's work", async () => {
    const ctxA = await loginCtx(uniq("carol"));
    const ctxB = await loginCtx(uniq("dave"));
    await makeBlock(ctxA, `CarolSecret-${Date.now()}`);

    const homeB = await (await ctxB.get(`${BASE}/api/home`)).json();
    const allText = JSON.stringify(homeB);
    expect(allText).not.toContain("CarolSecret");
    await ctxA.dispose();
    await ctxB.dispose();
  });
});

// ─── Injection-shaped payloads ───────────────────────────────

test.describe.serial("injection-shaped input", () => {
  test("SQL-looking titles are stored as plain text, not executed", async () => {
    const ctx = await loginCtx(uniq("sqltitle"));
    const nasty = "'; DROP TABLE blocks;--";
    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Injection",
        slots: [{ title: nasty, start: new Date(Date.now() + 3600000).toISOString(), durationMinutes: 30 }],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.blocks[0].title).toBe(nasty);

    // The blocks table still works fine afterwards
    const stillThere = await withDb(async (c) =>
      (await c.query(`SELECT title FROM blocks WHERE id = $1`, [body.blocks[0].id])).rows[0].title
    );
    expect(stillThere).toBe(nasty);
    await ctx.dispose();
  });

  test("script-looking titles round-trip as text", async () => {
    const ctx = await loginCtx(uniq("xsstitle"));
    const nasty = `<script>alert(1)</script>`;
    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "XSS",
        slots: [{ title: nasty, start: new Date(Date.now() + 3600000).toISOString(), durationMinutes: 30 }],
      },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).blocks[0].title).toBe(nasty);
    await ctx.dispose();
  });

  test("huge inputs are handled without a crash", async () => {
    const ctx = await loginCtx(uniq("huge"));
    const big = "x".repeat(50_000);
    const res = await ctx.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Big",
        slots: [{ title: big, start: new Date(Date.now() + 3600000).toISOString(), durationMinutes: 30 }],
      },
    });
    // Whatever it does, it must not 500
    expectNotServerError(res.status());
    await ctx.dispose();
  });
});

// ─── Racing requests ─────────────────────────────────────────

test.describe.serial("racing requests", () => {
  test("two simultaneous dones settle to exactly one success", async () => {
    const ctx = await loginCtx(uniq("racedone"));
    const blockId = await makeBlock(ctx);
    const [a, b] = await Promise.all([
      ctx.post(`${BASE}/api/blocks/${blockId}/done`, { data: {} }),
      ctx.post(`${BASE}/api/blocks/${blockId}/done`, { data: {} }),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses).toEqual([200, 404]);

    const status = await withDb(async (c) =>
      (await c.query(`SELECT status FROM blocks WHERE id = $1`, [blockId])).rows[0].status
    );
    expect(status).toBe("done");
    await ctx.dispose();
  });

  test("two simultaneous drops settle to exactly one success", async () => {
    const ctx = await loginCtx(uniq("racedrop"));
    const blockId = await makeBlock(ctx);
    const [a, b] = await Promise.all([
      ctx.post(`${BASE}/api/blocks/${blockId}/move`, { data: { target: "drop" } }),
      ctx.post(`${BASE}/api/blocks/${blockId}/move`, { data: { target: "drop" } }),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses).toEqual([200, 404]);
    await ctx.dispose();
  });
});

// ─── Closed blocks refuse mutation ───────────────────────────

test.describe.serial("closed blocks refuse mutation", () => {
  test("a dropped block cannot be revived, renamed, or extended", async () => {
    const ctx = await loginCtx(uniq("deadblock"));
    const blockId = await makeBlock(ctx);
    expect((await ctx.post(`${BASE}/api/blocks/${blockId}/move`, { data: { target: "drop" } })).status()).toBe(200);

    for (const attempt of [
      () => ctx.post(`${BASE}/api/blocks/${blockId}/done`, { data: {} }),
      () => ctx.post(`${BASE}/api/blocks/${blockId}/move`, { data: { target: "later_today" } }),
      () => ctx.post(`${BASE}/api/blocks/${blockId}/move`, { data: { target: "add_15" } }),
      () => ctx.patch(`${BASE}/api/blocks/${blockId}`, { data: { title: "zombie" } }),
    ]) {
      const res = await attempt();
      expect(res.status()).toBe(404);
    }
    await ctx.dispose();
  });
});

// ─── UI recovery after failed requests ───────────────────────

test.describe.serial("UI recovery", () => {
  test("home screen shows the error line and recovers on retry", async ({ page }) => {
    execSync("npm run db:reset", { stdio: "pipe", cwd: process.cwd() });

    // Sign in as sam
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, { data: { email: "sam@lyco.test" } });
    const body = await res.json();
    await ctx.dispose();
    await page.goto(body.link);
    await page.waitForLoadState("networkidle");

    // Break the home feed
    await page.route("**/api/home", (route) =>
      route.fulfill({ status: 500, json: { error: "boom" } })
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    await expect(page.getByText(/something went wrong loading your data/i)).toBeVisible();

    // Fix the feed and retry — real data comes back
    await page.unroute("**/api/home");
    await page.getByRole("button", { name: "try again" }).click();
    await expect(page.getByText("right now")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Draft the SimpleFIN adapter")).toBeVisible();
  });
});
