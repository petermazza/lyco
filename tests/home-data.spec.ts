import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const BASE = "http://localhost:3001";

test("home data renders from DB when authenticated", async ({ page, context }) => {
  // Reseed before this test to ensure fresh data
  execSync("npm run db:reset", { stdio: "pipe", cwd: process.cwd() });

  // Authenticate via magic link
  const ctx = await apiRequest.newContext();
  const res = await ctx.post(`${BASE}/api/auth/request-link`, {
    data: { email: "sam@lyco.test" },
  });
  const body = await res.json();
  await ctx.dispose();

  // Visit verify link to set session cookie
  await page.goto(body.link);
  await page.waitForLoadState("networkidle");

  // Should be on home page
  await expect(page).toHaveURL(/\/$/);

  // Wait for data to load (not loading skeleton)
  await page.waitForTimeout(2000);

  // Verify current block from DB
  await expect(page.getByText("Draft the SimpleFIN adapter")).toBeVisible();
  await expect(page.getByText(/90 minutes.*until.*calendar/)).toBeVisible();
  await expect(page.getByText(/minutes in/)).toBeVisible();
  await expect(page.getByText(/minutes left/)).toBeVisible();

  // Verify later today items from DB
  await expect(page.getByText("Walk, no phone")).toBeVisible();

  // Verify spending from DB
  await expect(page.getByText("Eating out")).toBeVisible();
  await expect(page.getByText("$186 of $240")).toBeVisible();
  await expect(page.getByText("Rideshare")).toBeVisible();
  await expect(page.getByText("$92 of $80")).toBeVisible();

  // Verify upcoming occasion from DB
  await expect(page.getByText("Mom's birthday")).toBeVisible();
  await expect(page.getByText("days", { exact: true })).toBeVisible();

  // Verify ratio from DB
  await expect(page.getByText(/you kept.*blocks this month/i)).toBeVisible();

  // Verify Done and Move it buttons are wired
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move it" })).toBeVisible();
});

test("home shows sign-in form when not authenticated", async ({ page, context }) => {
  // Clear any existing cookies
  await context.clearCookies();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  await expect(page.getByText("lyco")).toBeVisible();
  await expect(page.getByPlaceholder("your email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
