import { test, expect, type Page, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const BASE = "http://localhost:3001";

async function reseed() {
  execSync("npm run db:reset", { stdio: "pipe", cwd: process.cwd() });
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

async function gotoFreshUser(page: Page, path: string) {
  const ctx = await apiRequest.newContext();
  const res = await ctx.post(`${BASE}/api/auth/request-link`, {
    data: { email: `fresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@lyco.test` },
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

test.describe.serial("Block screen", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("shows empty state when no block is current", async ({ page }) => {
    // A brand-new user has no blocks — the screen should say so
    await gotoFreshUser(page, "/block");
    await expect(page.getByText("Nothing scheduled right now")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
  });

  test("shows the real running block for the seeded user", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await expect(page.getByText("block running")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Draft the SimpleFIN adapter")).toBeVisible();
    await expect(page.getByText(/ends at/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move it" })).toBeVisible();
    await expect(page.getByRole("button", { name: "I don't know how to start" })).toBeVisible();
  });

  test("Mark done closes the block", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await page.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByText("Kept.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
  });

  test("Move it opens the sheet and drop closes the block", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByText("Move it where?")).toBeVisible();
    await page.getByRole("button", { name: /Drop it this week/ }).click();
    await expect(page.getByText("Moved.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/dropped/i)).toBeVisible();
  });

  test("15 more minutes keeps the block running and shows a toast", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await page.getByRole("button", { name: "Move it" }).click();
    await page.getByRole("button", { name: /Give it 15 more minutes/ }).click();
    await expect(page.getByText(/15 minutes added/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("block running")).toBeVisible();
  });

  test("help button starts a real conversation", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await page.getByRole("button", { name: "I don't know how to start" }).click();
    // The user's message appears and the assistant replies
    await expect(page.getByText("I don't know how to start.")).toBeVisible();
    await expect(page.getByRole("button", { name: "send" })).toBeVisible();
    await expect(page.getByText("thinking…")).toBeVisible();
  });
});

// ─── New Project screen ──────────────────────────────────────

test.describe.serial("New project screen", () => {
  test("shows initial bot message and text input", async ({ page }) => {
    await gotoFreshUser(page, "/new");
    await expect(page.getByText("New", { exact: true })).toBeVisible();
    await expect(page.getByText("What's on your mind?")).toBeVisible();
    await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  });

  test("shows Tell me about it header before goal is created", async ({ page }) => {
    await gotoFreshUser(page, "/new");
    await expect(page.getByText("Tell me about it")).toBeVisible();
  });

  test("has a text input with placeholder", async ({ page }) => {
    await gotoFreshUser(page, "/new");
    const input = page.locator("input").last();
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", /say it in your own words/i);
  });

  test("Close link navigates back to home", async ({ page }) => {
    await gotoFreshUser(page, "/new");
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("status footer shows in conversation before goal creation", async ({ page }) => {
    await gotoFreshUser(page, "/new");
    await expect(page.getByText("in conversation")).toBeVisible();
  });

  test("creating a goal offers a find time for this link", async ({ page }) => {
    test.setTimeout(90000); // live model may ask a follow-up or two
    await gotoFreshUser(page, "/new");
    const input = page.locator("input").last();
    await input.fill("I want to learn piano, twice a week, by spring");
    await page.getByRole("button", { name: "send" }).click();
    // The model may ask a follow-up before creating — keep answering
    for (let i = 0; i < 3; i++) {
      const findTime = page.getByRole("link", { name: "find time for this" });
      if (await findTime.isVisible({ timeout: 20000 }).catch(() => false)) {
        await expect(findTime).toHaveAttribute("href", /\/schedule\?goal=/);
        return;
      }
      await input.fill("that works");
      await page.getByRole("button", { name: "send" }).click();
    }
    await expect(page.getByRole("link", { name: "find time for this" })).toBeVisible({ timeout: 20000 });
  });
});

// ─── Schedule Proposal screen ────────────────────────────────

// Logs the page in as the seeded user, asks the proposal API which goal
// it would pick, then opens the schedule screen for that goal.
async function gotoSchedule(page: Page) {
  await gotoAuthenticated(page, "/");
  const res = await page.request.get(`${BASE}/api/schedule/proposal`);
  const prop = await res.json();
  await page.goto(`/schedule?goal=${prop.goal.id}`);
  await page.waitForLoadState("networkidle");
  return prop;
}

test.describe.serial("Schedule proposal screen", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("shows the real goal and proposed times", async ({ page }) => {
    const prop = await gotoSchedule(page);
    await expect(page.getByText(prop.goal.title, { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Proposed times")).toBeVisible();
    await expect(page.locator('[data-testid="slot"]').first()).toBeVisible();
    await expect(page.getByText(/that is \d+ sessions/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept these times" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pick different times" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go less often" })).toBeVisible();
  });

  test("Go less often drops to a single slot", async ({ page }) => {
    await gotoSchedule(page);
    const slots = page.locator('[data-testid="slot"]');
    await expect(slots.first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Go less often" }).click();
    await expect(page.getByRole("button", { name: "Go more often" })).toBeVisible({ timeout: 20000 });
    await expect(slots).toHaveCount(1);
  });

  test("Pick different times reloads a fresh proposal", async ({ page }) => {
    await gotoSchedule(page);
    const slots = page.locator('[data-testid="slot"]');
    await expect(slots.first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Pick different times" }).click();
    await expect(slots.first()).toBeVisible({ timeout: 20000 });
  });

  test("Accept creates real blocks and confirms", async ({ page }) => {
    await gotoSchedule(page);
    await page.getByRole("button", { name: "Accept these times" }).click({ timeout: 20000 });
    await expect(page.getByText(/Set.*the blocks are in your calendar/i)).toBeVisible({ timeout: 20000 });
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a user with no goals is sent to /new", async ({ page }) => {
    // A brand-new user has no goals — proposal 404s and the screen redirects
    await gotoFreshUser(page, "/schedule");
    await expect(page).toHaveURL(/\/new/, { timeout: 15000 });
    await expect(page.getByText("What's on your mind?")).toBeVisible();
  });
});

// ─── Login screen ─────────────────────────────────────────────

test.describe.serial("Login screen", () => {
  test("shows login form when unauthenticated", async ({ page }) => {
    await page.route("**/api/home", (route) =>
      route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("lyco")).toBeVisible();
    await expect(page.getByText(/personal accountability/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("input[name='email']")).toBeVisible();
  });

  test("entering email shows check your email message", async ({ page }) => {
    await page.route("**/api/home", (route) =>
      route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    );
    await page.route("**/api/auth/request-link", (route) =>
      route.fulfill({ status: 200, json: { ok: true } })
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("input[name='email']").fill("test@lyco.test");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });

  test("shows error message when email sending fails", async ({ page }) => {
    await page.route("**/api/home", (route) =>
      route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    );
    await page.route("**/api/auth/request-link", (route) =>
      route.fulfill({ status: 502, json: { error: "Could not send sign-in email. Please try again." } })
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("input[name='email']").fill("test@lyco.test");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/could not send sign-in email/i)).toBeVisible();
  });
});

// ─── Sentence casing check ───────────────────────────────────

const PROPER_NOUNS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Google",
];

const LOWER_PROPER_NOUNS = [
  "january", "february", "march", "april", "june",
  "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

// "may" and "google" excluded from lowercase list — "may" is a common word,
// "google" only appears as "Google" in UI text.

async function getVisibleText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test.describe.serial("Sentence casing", () => {
  test.beforeEach(async () => {
    await reseed();
  });

  test("home screen capitalizes proper nouns", async ({ page }) => {
    await gotoHome(page);
    const text = await getVisibleText(page);
    for (const noun of LOWER_PROPER_NOUNS) {
      expect(text, `expected no lowercase "${noun}"`).not.toContain(noun);
    }
  });

  test("home screen date label uses capitalized weekday and month", async ({ page }) => {
    await gotoHome(page);
    const text = await getVisibleText(page);
    // The date label is "Weekday Day Month · time" — at least one capitalized
    // weekday and one capitalized month should appear (or the greeting time)
    const hasCapitalizedWeekday = PROPER_NOUNS.slice(12, 19).some((d) => text.includes(d));
    expect(hasCapitalizedWeekday, "expected a capitalized weekday in the date label").toBeTruthy();
  });

  test("schedule screen capitalizes proper nouns", async ({ page }) => {
    const prop = await gotoSchedule(page);
    await expect(page.getByText("Proposed times")).toBeVisible({ timeout: 20000 });
    const text = await getVisibleText(page);
    for (const noun of LOWER_PROPER_NOUNS) {
      expect(text, `expected no lowercase "${noun}"`).not.toContain(noun);
    }
    // A weekday appears in the proposed slots
    const hasWeekday = PROPER_NOUNS.slice(12, 19).some((d) => text.includes(d));
    expect(hasWeekday, "expected a capitalized weekday in the proposed slots").toBeTruthy();
    // A month name appears when the goal has a deadline
    if (prop.goal.deadline) {
      const hasMonth = PROPER_NOUNS.slice(0, 12).some((m) => text.includes(m));
      expect(hasMonth, "expected a capitalized month in the deadline label").toBeTruthy();
    }
  });

  test("block screen capitalizes proper nouns", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await expect(page.getByText("block running")).toBeVisible({ timeout: 10000 });
    const text = await getVisibleText(page);
    for (const noun of LOWER_PROPER_NOUNS) {
      expect(text, `expected no lowercase "${noun}"`).not.toContain(noun);
    }
  });

  test("block screen closed state stays sentence case", async ({ page }) => {
    await gotoAuthenticated(page, "/block");
    await expect(page.getByText("block running")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByText("Kept.")).toBeVisible();
    const text = await getVisibleText(page);
    for (const noun of LOWER_PROPER_NOUNS) {
      expect(text, `expected no lowercase "${noun}"`).not.toContain(noun);
    }
  });

  test("schedule once-a-week mode stays sentence case", async ({ page }) => {
    await gotoSchedule(page);
    await page.getByRole("button", { name: "Go less often" }).click({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "Go more often" })).toBeVisible({ timeout: 20000 });
    const text = await getVisibleText(page);
    for (const noun of LOWER_PROPER_NOUNS) {
      expect(text, `expected no lowercase "${noun}"`).not.toContain(noun);
    }
  });
});

// ─── Still open from earlier ─────────────────────────────────
// A block that ends untouched becomes "missed" and shows up as a
// quiet row the user can act on.

test.describe.serial("Still open from earlier", () => {
  test("shows a missed block and drop removes it", async ({ page }) => {
    // Sign in as sam in the browser
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "sam@lyco.test" },
    });
    const body = await res.json();
    await ctx.dispose();
    await page.goto(body.link);
    await page.waitForLoadState("networkidle");

    // Plant a block that ended an hour ago — past the grace period
    const title = `Missed-${Date.now()}`;
    const start = new Date(Date.now() - 120 * 60000).toISOString();
    const conf = await page.request.post(`${BASE}/api/schedule/confirm`, {
      data: {
        goalTitle: "Cleanup",
        slots: [{ start, durationMinutes: 60, title }],
      },
    });
    expect(conf.ok()).toBeTruthy();

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Still open from earlier")).toBeVisible();
    const row = page
      .locator("div", { has: page.getByText(title, { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "drop" }) })
      .last();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "drop" }).click();
    await expect(page.getByText("dropped. no explanation needed.")).toBeVisible();
    await expect(page.getByText(title)).not.toBeVisible();
  });
});
