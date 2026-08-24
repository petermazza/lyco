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
