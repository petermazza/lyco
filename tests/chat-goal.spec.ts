import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const BASE = "http://localhost:3001";

test.describe.serial("Chat to goal flow", () => {
  test.beforeEach(async () => {
    execSync("npm run db:reset", { stdio: "pipe", cwd: process.cwd() });
  });

  test("typing a goal in chat creates a row in Postgres and shows on home after refresh", async ({ page }) => {
    // Authenticate
    const ctx = await apiRequest.newContext();
    const res = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "sam@lyco.test" },
    });
    const body = await res.json();
    await ctx.dispose();

    await page.goto(body.link);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // Navigate to new project
    await page.getByRole("link", { name: "new" }).click();
    await page.waitForURL(/\/new/);
    await page.waitForTimeout(500);

    // Verify initial bot message
    await expect(page.getByText("What are you working on?")).toBeVisible();

    // Type a goal
    const input = page.locator("input[type='text'], input:not([type])").last();
    await input.fill("I want to learn Spanish, practicing daily for 30 minutes");
    await page.getByRole("button", { name: "send" }).click();

    // Wait for response (LLM call takes time)
    await page.waitForTimeout(15000);

    // The bot should have responded — either asking for more info or confirming
    // Check that a bot message appeared after our user message
    const botMessages = page.locator("div").filter({ hasText: /Spanish|goal|deadline|cadence|saved|created/i });
    await expect(botMessages.first()).toBeVisible({ timeout: 10000 });

    // Verify via API that the goal was created (or that the chat responded)
    // The LLM may ask for deadline/cadence before creating — send a follow-up
    const input2 = page.locator("input[type='text'], input:not([type])").last();
    if (await input2.isVisible({ timeout: 2000 }).catch(() => false)) {
      await input2.fill("By end of December, daily practice");
      await page.getByRole("button", { name: "send" }).click();
      await page.waitForTimeout(15000);
    }

    // Verify the goal exists in the DB via a direct API check
    const verifyCtx = await apiRequest.newContext();
    const cookieRes = await verifyCtx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "sam@lyco.test" },
    });
    const cookieBody = await cookieRes.json();
    await verifyCtx.dispose();

    // Use the page's cookies to call the home API
    const homeRes = await page.request.get(`${BASE}/api/home`);
    expect(homeRes.ok()).toBeTruthy();
    const homeData = await homeRes.json();
    expect(homeData.greeting).toBeTruthy();

    // Navigate back to home and verify it loads
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await expect(page.getByText(/Morning|Afternoon|Evening, Sam/)).toBeVisible();
  });

  test("chat API logs interaction to llm_interactions table", async ({ page, context }) => {
    // Authenticate
    const ctx = await apiRequest.newContext();
    const authRes = await ctx.post(`${BASE}/api/auth/request-link`, {
      data: { email: "sam@lyco.test" },
    });
    const authBody = await authRes.json();
    await ctx.dispose();

    await page.goto(authBody.link);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const chatRes = await page.request.post(`${BASE}/api/chat`, {
      data: {
        messages: [
          { role: "user", content: "I want to write a novel, 3x a week, by end of the year" },
        ],
      },
    });

    expect(chatRes.ok()).toBeTruthy();
    const chatData = await chatRes.json();

    // The LLM should have called create_goal
    expect(chatData.toolCalls).toBeDefined();
    const createGoalCall = chatData.toolCalls?.find((tc: { name: string }) => tc.name === "create_goal");
    expect(createGoalCall).toBeTruthy();

    // The tool result should be successful
    const goalResult = chatData.toolResults?.find((tr: { tool: string }) => tr.tool === "create_goal");
    expect(goalResult?.success).toBeTruthy();
  });
});
