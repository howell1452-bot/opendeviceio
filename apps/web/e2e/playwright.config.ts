import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a local Supabase stack (e2e/supabase-up.sh) and a
// production build of the site. Run from apps/web:
//   bash e2e/supabase-up.sh && set -a && . e2e/.env.e2e && set +a
//   ADMIN_EMAILS=admin@odio.test npm run build && npx playwright test -c e2e
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "npm run start -- -p 3000",
    cwd: "..",
    url: "http://localhost:3000/about",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
