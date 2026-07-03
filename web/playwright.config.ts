import { defineConfig, devices } from '@playwright/test';

// ── e2e DB isolation ──────────────────────────────────────────────────────
// DEFAULT: e2e runs against a THROWAWAY data root on a dedicated port (3100).
// global-setup creates a temp MENTIKO_GLOBAL_ROOT + DATABASE_URL (pointed at a
// temp auth.db) and sets PORT=3100 on the ephemeral dev server the harness
// spawns — signups, runs, and artifacts NEVER touch the real ~/.mentiko (no
// test-user pollution, no auth.db bloat). Matches the isolation pattern in
// web/lib/__tests__/review-store.test.ts.
//
// The harness-managed server on :3100 is a SEPARATE process from the
// interactive dev server on :3000 (tmux mentiko-dev) — it does not touch or
// kill it. The "never start a 2nd npm run dev" rule refers to the interactive
// :3000 server; a Playwright-managed test server on another port is expected.
//
// Escape hatch — set E2E_REUSE_DEV=1 to piggyback on an already-running :3000
// server (faster iteration; you accept shared-DB pollution — clean it with
// `node scripts/clean-test-users.mjs --apply`).
const REUSE_DEV = process.env.E2E_REUSE_DEV === '1';
const baseURL = REUSE_DEV ? 'http://localhost:3000' : 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  globalSetup: REUSE_DEV ? undefined : './e2e/global-setup.ts',
  globalTeardown: REUSE_DEV ? undefined : './e2e/global-teardown.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: REUSE_DEV,
    timeout: 180 * 1000,
  },
});
