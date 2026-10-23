import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Source-level contract tests: these run inside the Playwright suite so they
// share its dev-server/database setup, but they assert on source and spawned
// script behavior rather than HTTP.

const ROOT = path.resolve(__dirname, "..");

function findRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findRoutes(p));
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

// Routes that are public BY DESIGN. Every other src/app/api/**/route.ts must
// resolve the caller through getCurrentUser() (src/lib/session.ts) — the same
// helper all session-protected routes use.
const PUBLIC_ROUTES: Record<string, string> = {
  "auth/request-link":
    "sign-in entry point — issues the magic link; rate-limited by email and IP",
  "auth/verify":
    "redeems the magic-link token — this endpoint IS the authentication step",
  "auth/logout":
    "idempotent sign-out — only deletes the presented session token and clears the cookie",
  "user/reminders":
    "one-click unsubscribe from reminder emails — authorized by an HMAC-signed link, not a session",
};

test.describe("API route auth contract", () => {
  const routes = findRoutes(path.join(ROOT, "src/app/api"));

  test("every route either authenticates via getCurrentUser or is explicitly public", () => {
    expect(routes.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of routes) {
      const rel = path
        .relative(path.join(ROOT, "src/app/api"), file)
        .replace(/\/route\.ts$/, "");
      const src = readFileSync(file, "utf-8");
      if (PUBLIC_ROUTES[rel]) continue;
      if (!/getCurrentUser/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `routes with no auth check and no allowlist entry: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  test("the public allowlist stays honest — every entry really is a route file", () => {
    for (const rel of Object.keys(PUBLIC_ROUTES)) {
      const file = path.join(ROOT, "src/app/api", rel, "route.ts");
      expect(() => readFileSync(file, "utf8"), rel).not.toThrow();
    }
  });
});

test.describe("DEV_USER_ID dev bypass", () => {
  // dev-bypass.ts throws at import when DEV_USER_ID is set outside
  // development — spawn it in a clean process to see the real boot behavior.
  const runBypass = (env: Record<string, string>) =>
    execSync(
      `node --import tsx -e "import('./src/lib/dev-bypass.ts').then(m => console.log('enabled=' + m.isDevBypassEnabled()))"`,
      { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );

  test("refuses to boot in production", () => {
    let stderr = "";
    let exited = false;
    try {
      runBypass({ NODE_ENV: "production", DEV_USER_ID: "00000000-0000-0000-0000-000000000001", DATABASE_URL: "postgresql://localhost:5433/lyco_test" });
    } catch (err: any) {
      exited = true;
      stderr = String(err.stderr ?? err.message);
    }
    expect(exited, "dev-bypass should have thrown in production").toBe(true);
    expect(stderr).toContain("DEV_USER_ID");
    expect(stderr).toMatch(/production/);
  });

  test("is honored only in development", () => {
    const out = runBypass({ NODE_ENV: "development", DEV_USER_ID: "00000000-0000-0000-0000-000000000001", DATABASE_URL: "postgresql://localhost:5433/lyco_test" });
    expect(out.includes("enabled=true"), `spawn output was: ${JSON.stringify(out)}`).toBe(true);
  });
});

test.describe("db:reset safety", () => {
  test("refuses to run against a non-local (Railway) host", () => {
    let output = "";
    let exited = false;
    try {
      execSync(`node --import tsx scripts/db-reset.ts`, {
        cwd: ROOT,
        env: {
          ...process.env,
          TEST_DATABASE_URL: "postgresql://u@containers-us-west.rlwy.net:7777/railway",
          DATABASE_URL: "postgresql://u@containers-us-west.rlwy.net:7777/railway",
        },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      exited = true;
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(exited, "db:reset should refuse a Railway host").toBe(true);
    expect(output).toMatch(/Refusing to run db-reset/);
  });
});

test.describe("login page layout", () => {
  test("no horizontal overflow at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    // The signed-out view is the sign-in form.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("dependency security audit contract", () => {
  test("npm run check:audit reports zero high/critical production vulnerabilities", () => {
    const out = execSync("npm run check:audit", {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toContain("found 0 vulnerabilities");
  });
});
