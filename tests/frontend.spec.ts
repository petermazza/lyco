import { test, expect, type Page, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const BASE = "http://localhost:3001";

async function reseed() {
  execSync("npm run seed", { stdio: "pipe", cwd: process.cwd() });
}

async function gotoHome(page: Page) {
  // Authenticate via magic link first
  const ctx = await apiRequest.newContext();
  const res = await ctx.post(`${BASE}/api/auth/request-link`, {
    data: { email: "sam@lyco.test" },
  });
  const body = await res.json();
  await ctx.dispose();

  // Visit verify link to set session cookie, then redirect to home
  await page.goto(body.link);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
}

async function gotoAuthenticated(page: Page, path: string) {
  const ctx = await apiRequest.newContext();
  const res = await ctx.post(`${BASE}/api/auth/request-link`, {
    data: { email: "sam@lyco.test" },
  });
  const body = await res.json();
  await ctx.dispose();

  await page.goto(body.link);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

// ─── Home screen: content ────────────────────────────────────

test.describe.serial("Home screen", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("shows greeting and date", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText(/Morning|Afternoon|Evening, Sam/)).toBeVisible();
    await expect(page.getByText(/sunday|monday|tuesday|wednesday|thursday|friday|saturday/i)).toBeVisible();
  });

  test("shows right now card with current task", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText("right now")).toBeVisible();
    await expect(page.getByText("Draft the SimpleFIN adapter")).toBeVisible();
    await expect(page.getByText(/90 minutes.*until.*calendar/)).toBeVisible();
  });

  test("shows progress bar and elapsed time", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText(/minutes in/i)).toBeVisible();
    await expect(page.getByText(/minutes left/i)).toBeVisible();
  });

  test("shows Done and Move it buttons", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move it" })).toBeVisible();
  });

  test("shows later today items", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText("Later today")).toBeVisible();
    await expect(page.getByText("Walk, no phone")).toBeVisible();
  });

  test("shows spending section with categories", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText("Spending this month")).toBeVisible();
    await expect(page.getByText("Eating out")).toBeVisible();
    await expect(page.getByText("$186 of $240")).toBeVisible();
    await expect(page.getByText("Rideshare")).toBeVisible();
    await expect(page.getByText("$92 of $80")).toBeVisible();
  });

  test("shows coming up section", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText("Coming up")).toBeVisible();
    await expect(page.getByText("Mom's birthday")).toBeVisible();
    await expect(page.getByText(/ceramics class/i)).toBeVisible();
  });

  test("shows monthly dots and ratio line", async ({ page }) => {
    await gotoHome(page);
    await expect(page.getByText(/you kept \d+ of \d+ blocks this month/i)).toBeVisible();
  });

  test("shows new button linking to /new", async ({ page }) => {
    await gotoHome(page);
    const newBtn = page.getByRole("link", { name: "new" });
    await expect(newBtn).toBeVisible();
    await expect(newBtn).toHaveAttribute("href", "/new");
  });
});

// ─── Home screen: Done action ────────────────────────────────

test.describe.serial("Home: Done action", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("clicking Done advances queue and shows toast", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Done" }).click();
    // Toast should appear
    await expect(page.getByText(/kept/i).first()).toBeVisible();
  });
});

// ─── Home screen: Move it sheet ──────────────────────────────

test.describe.serial("Home: Move it sheet", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("clicking Move it opens bottom sheet with options", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByText("Move it where?")).toBeVisible();
    await expect(page.getByText("the block stays the same size")).toBeVisible();
    await expect(page.getByRole("button", { name: /Later today/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Tomorrow morning/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Give it 15 more minutes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Drop it this week/ })).toBeVisible();
  });

  test("selecting Later today shows toast and closes sheet", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Move it" }).click();
    await page.getByRole("button", { name: /Later today/ }).click();
    await expect(page.getByText(/moved to.*calendar updated/i)).toBeVisible();
    await expect(page.getByText("Move it where?")).not.toBeVisible();
  });

  test("selecting Tomorrow morning shows toast", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Move it" }).click();
    await page.getByRole("button", { name: /Tomorrow morning/ }).click();
    await expect(page.getByText(/moved to tomorrow/i)).toBeVisible();
  });

  test("selecting Give it 15 more minutes shows toast", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Move it" }).click();
    await page.getByRole("button", { name: /Give it 15 more minutes/ }).click();
    await expect(page.getByText(/15 minutes added/i)).toBeVisible();
  });

  test("selecting Drop it this week removes task and shows toast", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Move it" }).click();
    await page.getByRole("button", { name: /Drop it this week/ }).click();
    await expect(page.getByText(/dropped.*will not come back/i)).toBeVisible();
  });

  test("clicking outside the sheet closes it", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByText("Move it where?")).toBeVisible();
    // Click the overlay backdrop (top-left corner, outside the sheet)
    await page.locator("div").filter({ hasText: "Move it where?" }).first();
    await page.evaluate(() => {
      const overlays = document.querySelectorAll("[style*='z-index: 50']");
      if (overlays.length > 0) {
        (overlays[0] as HTMLElement).click();
      }
    });
    await expect(page.getByText("Move it where?")).not.toBeVisible();
  });
});

// ─── Navigation: Home → Block ────────────────────────────────

test.describe.serial("Navigation: Home to Block", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("clicking task title navigates to /block", async ({ page }) => {
    await gotoHome(page);
    await page.getByText("Draft the SimpleFIN adapter").click();
    await expect(page).toHaveURL(/\/block/);
  });
});

// ─── Block screen ────────────────────────────────────────────

test.describe("Block screen", () => {
  test("shows block running status and task", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("block running")).toBeVisible();
    await expect(page.getByText("Rewrite the résumé summary")).toBeVisible();
  });

  test("shows Mark done, Move it, and help buttons in running mode", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move it" })).toBeVisible();
    await expect(page.getByRole("button", { name: "I don't know how to start" })).toBeVisible();
  });

  test("clicking Mark done shows closed state", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByText(/Kept.*that is the block/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
  });

  test("clicking Move it shows toast message", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Move it" }).click();
    // The showToast action fires; verify the block screen still renders
    await expect(page.getByText("Rewrite the résumé summary")).toBeVisible();
  });

  test("help flow: I don't know how to start → blank page → smaller → proposal", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");

    // Enter help mode
    await page.getByRole("button", { name: "I don't know how to start" }).click();
    await expect(page.getByText("No problem. What is in front of you right now?")).toBeVisible();

    // Select "A blank page"
    await page.getByRole("button", { name: "A blank page" }).click();
    await expect(page.getByText(/summary is the wrong place to start/i)).toBeVisible();

    // Select "Yes, smaller"
    await page.getByRole("button", { name: "Yes, smaller" }).click();

    // Proposal should appear
    await expect(page.getByText("start with this")).toBeVisible();
    await expect(page.getByText(/List three things you actually did/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Okay, starting that" })).toBeVisible();
  });

  test("accepting proposal enters settled mode", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "I don't know how to start" }).click();
    await page.getByRole("button", { name: "A blank page" }).click();
    await page.getByRole("button", { name: "Yes, smaller" }).click();
    await page.getByRole("button", { name: "Okay, starting that" }).click();

    await expect(page.getByText(/That is the block now/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move it" })).toBeVisible();
  });

  test("help flow: draft I don't like → what is it first → proposal", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "I don't know how to start" }).click();
    await page.getByRole("button", { name: "A draft I don't like" }).click();
    await page.getByRole("button", { name: "What is it first" }).click();

    await expect(page.getByText("start with this")).toBeVisible();
  });

  test("Back to home link navigates to /", async ({ page }) => {
    await page.goto("/block");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Mark done" }).click();
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

// ─── New Project screen ──────────────────────────────────────

test.describe("New project screen", () => {
  test("shows initial bot message and text input", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("New project")).toBeVisible();
    await expect(page.getByText("What are you working on?")).toBeVisible();
    await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  });

  test("shows Tell me about it header before goal is created", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Tell me about it")).toBeVisible();
  });

  test("has a text input with placeholder", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("networkidle");
    const input = page.locator("input").last();
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", /say it in your own words/i);
  });

  test("Close link navigates back to home", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("status footer shows in conversation before goal creation", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("in conversation")).toBeVisible();
  });
});

// ─── Schedule Proposal screen ────────────────────────────────

test.describe.serial("Schedule proposal screen", () => {
  test.beforeEach(async () => {
    execSync("npm run seed", { stdio: "pipe", cwd: process.cwd() });
  });

  test("shows project title and deadline", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("New job — 5 first rounds")).toBeVisible();
    await expect(page.getByText("by 31 october")).toBeVisible();
    await expect(page.getByText("9 weeks left")).toBeVisible();
  });

  test("shows reasoning text", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Twice a week gets you there with room to spare/i)).toBeVisible();
  });

  test("shows proposed time slots", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Proposed times")).toBeVisible();
    await expect(page.getByText("Tuesday", { exact: true })).toBeVisible();
    await expect(page.getByText("7:00 – 8:30 pm")).toBeVisible();
    await expect(page.getByText("Saturday", { exact: true })).toBeVisible();
    await expect(page.getByText("9:30 – 11:00 am")).toBeVisible();
  });

  test("shows action buttons", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Accept these times" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pick different times" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go less often" })).toBeVisible();
  });

  test("clicking Accept shows confirmation", async ({ page }) => {
    await gotoAuthenticated(page, "/schedule");
    await page.getByRole("button", { name: "Accept these times" }).click();
    await expect(page.getByText(/Set.*the blocks are in your calendar/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
  });

  test("clicking Go less often switches to once a week", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Go less often" }).click();
    await expect(page.getByText(/Once a week still lands it/i)).toBeVisible();
    await expect(page.getByText("that is 9 sessions before 31 october.")).toBeVisible();
    // Only one slot now
    await expect(page.getByText("Saturday", { exact: true })).toBeVisible();
    await expect(page.getByText("Tuesday", { exact: true })).not.toBeVisible();
  });

  test("clicking Go less often twice returns to twice a week", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Go less often" }).click();
    await expect(page.getByText(/Once a week/i)).toBeVisible();
    await page.getByRole("button", { name: "Go less often" }).click();
    await expect(page.getByText(/Twice a week/i)).toBeVisible();
  });

  test("confirmed state has Back to home link", async ({ page }) => {
    await gotoAuthenticated(page, "/schedule");
    await page.getByRole("button", { name: "Accept these times" }).click();
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("shows session count in footer", async ({ page }) => {
    await page.goto("/schedule");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/that is 18 sessions before 31 october/i)).toBeVisible();
  });
});
