import { defineConfig, devices } from "@playwright/test";

// Tests run against a dedicated local database so db:reset and seeded
// @lyco.test accounts never touch the shared Railway data.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://petermazza@localhost:5433/lyco_test";

// The seed and several tests plant blocks relative to "now" (a running block
// 20 minutes ago, missed blocks 2 hours ago, scheduled blocks +75/+120/+180
// minutes out). Runs that start within ~2 hours of midnight push some of
// those across the date line, and the app's "today" then legitimately
// contains nothing. When the machine clock is in that danger window, boot
// the dev server under a timezone where it is still early on THIS machine's
// calendar date — every user with no stored timezone then sees the same
// "today" the test expectations assume.
function testServerTz(): string | undefined {
  const d = new Date();
  const hour = d.getHours() + d.getMinutes() / 60;
  if (hour >= 2 && hour < 21) return undefined; // machine-local "today" has room
  const utcHour = d.getUTCHours();
  const machineShift = Math.floor((utcHour - d.getTimezoneOffset() / 60) / 24);
  for (let h = 3; h <= 19; h++) {
    const o = h - utcHour + 24 * machineShift;
    if (o >= -12 && o <= 14) {
      return o === 0 ? "Etc/UTC" : o > 0 ? `Etc/GMT-${o}` : `Etc/GMT+${-o}`;
    }
  }
  return undefined; // no fixed zone reaches early-today; run as-is
}
const TEST_SERVER_TZ = testServerTz();

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    // The app learns each user's timezone from the browser, so the
    // emulation has to match the server's or UI tests drift back to the
    // machine's zone.
    ...(TEST_SERVER_TZ ? { timezoneId: TEST_SERVER_TZ } : {}),
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
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      ...(TEST_SERVER_TZ ? { TZ: TEST_SERVER_TZ } : {}),
    },
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
