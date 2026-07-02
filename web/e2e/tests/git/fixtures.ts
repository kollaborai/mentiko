/**
 * Git E2E Test Fixtures
 *
 * Shared Playwright fixtures for the Git workflow test suite.
 * Provides an authenticated session and a ready GitPanelPage instance.
 *
 * Intended project location: web/e2e/tests/git/fixtures.ts
 *
 * Usage in test files:
 *   import { test, expect } from './fixtures';
 *
 *   test('branch operations', async ({ gitPanel }) => {
 *     const branches = await gitPanel.listBranches();
 *     expect(branches.length).toBeGreaterThan(0);
 *   });
 *
 * Auth strategy:
 *   Injects a valid better-auth session cookie into the browser context.
 *   The server requires a real session token to serve protected pages.
 *   Token MUST be provided via E2E_SESSION_TOKEN (never hardcoded — public repo).
 *   Obtain via: sqlite3 ~/.mentiko/data/auth.db
 *     "SELECT token FROM session WHERE expiresAt > datetime('now') ORDER BY expiresAt DESC LIMIT 1;"
 */

import { test as base, expect, Page } from '@playwright/test';
import { GitPanelPage } from './git-panel.page';

// ── Fixture type declarations ────────────────────────────────────────────────

type GitFixtures = {
  /**
   * GitPanelPage — authenticated, navigated to /code with git view active.
   * Tests receive this already mounted; no extra setup needed.
   */
  gitPanel: GitPanelPage;
};

// A real-looking workspace path for the code editor to render with a projectRoot.
// Defaults to the checkout the tests run from; override for a specific workspace.
const E2E_WORKSPACE_PATH = process.env.E2E_WORKSPACE_PATH || process.cwd();

// The session token comes from the dev auth.db. It must be valid (not expired) for the
// server-side session check to pass (the server returns 307 → /login without a valid cookie).
// Obtain one via: sqlite3 ~/.mentiko/data/auth.db
//   "SELECT token FROM session WHERE expiresAt > datetime('now') ORDER BY expiresAt DESC LIMIT 1;"
// Never hardcode a token here — this repo is public.
const SESSION_TOKEN = process.env.E2E_SESSION_TOKEN || '';
if (!SESSION_TOKEN) {
  throw new Error(
    'E2E_SESSION_TOKEN is required for the git e2e suite (see fixtures.ts header for how to mint one).'
  );
}

/**
 * Inject a valid better-auth session cookie into the browser context so the
 * server-side session check on page routes passes (returns 200, not 307 → /login).
 * Also mock /api/config so the code editor has a projectRoot to render with.
 */
async function injectSession(page: Page): Promise<void> {
  // Inject the session cookie before any navigation — use url (not domain) for localhost
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: SESSION_TOKEN,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  // Config root so CodeEditorClient renders instead of "could not resolve project root"
  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { root: E2E_WORKSPACE_PATH },
      }),
    });
  });
}

// ── Extended test object ─────────────────────────────────────────────────────

export const test = base.extend<GitFixtures>({
  /**
   * gitPanel fixture — the main fixture for this suite.
   * Setup sequence:
   *   1. Inject session cookie so server returns 200 on /code instead of 307→/login
   *   2. Construct GitPanelPage
   *   3. Navigate to /code, click "Source Control", wait for branch selector
   *   4. Hand the fixture to the test body
   */
  gitPanel: async ({ page }, use) => {
    // 1. Inject session cookie so the server-side auth check passes (avoids 307→/login)
    await injectSession(page);

    // 2. Build page object
    const gitPanel = new GitPanelPage(page);

    // 3. Open the git panel (navigates + waits for mount)
    await gitPanel.openGitPanel();

    // 4. Assert the panel is usable before handing it to the test
    await expect(gitPanel.branchTrigger).toBeVisible({ timeout: 15000 });

    // 5. Hand to test
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not a React hook
    await use(gitPanel);
    // No teardown needed — each test gets a fresh browser context
  },
});

// Re-export expect so test files only need to import from fixtures
export { expect } from '@playwright/test';

// ── Shared test data ──────────────────────────────────────────────────────────

/**
 * Branch names used across the test suite.
 * Using a shared constant prevents name collisions between tests.
 */
export const TEST_BRANCHES = {
  feature: 'e2e-test-feature-branch',
  temp: 'e2e-test-temp-branch',
} as const;

/**
 * Stash messages used across the test suite.
 */
export const TEST_STASHES = {
  basic: 'e2e test stash',
  withMessage: 'e2e stash with custom message',
} as const;

/**
 * Commit messages used across the test suite.
 */
export const TEST_COMMITS = {
  basic: 'e2e: test commit message',
} as const;
