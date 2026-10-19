import { defineConfig, devices } from "@playwright/test";

// Tests run against a dedicated local database so db:reset and seeded
// @lyco.test accounts never touch the shared Railway data.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://petermazza@localhost:5433/lyco_test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // DEV_USER_ID= clears the dev-bypass so tests always run against
    // real sign-in, regardless of the developer's local .env.local.
    // DATABASE_URL points the test server at the local test database.
    command: "DEV_USER_ID= npm run dev",
    env: { DATABASE_URL: TEST_DATABASE_URL },
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
