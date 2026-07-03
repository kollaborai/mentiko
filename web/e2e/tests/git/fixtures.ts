/**
 * Git E2E Test Fixtures
 *
 * Shared Playwright fixtures for the Git workflow test suite. Provides an
 * authenticated session (a SIGNED better-auth cookie — see note below) and a
 * ready GitPanelPage instance mounted on a scratch git repo.
 *
 * Usage in test files:
 *   import { test, expect } from './fixtures';
 *   test('branch operations', async ({ gitPanel }) => { ... });
 *
 * ── Auth strategy (read this — it changed) ───────────────────────────────
 * better-auth 1.6.15 sets a SIGNED session cookie: the cookie value is
 * `<token>.<base64-hmac>` where the hmac key is HKDF-SHA256(BETTER_AUTH_SECRET,
 * "mentiko-session-signing-v1") (see lib/secrets/dev-secret.ts). Injecting the
 * RAW `session.token` column value — which earlier revisions of this file did —
 * does NOT authenticate; better-auth verifies the signature and rejects it.
 *
 * So we obtain a legitimately-issued signed cookie instead:
 *   - Default (isolated e2e env, see playwright.config.ts → :3100 with a
 *     throwaway auth.db): bootstrap-signup a fixed e2e account (allowed because
 *     the temp DB starts empty) and read the signed cookie from Set-Cookie.
 *   - Override: set E2E_SESSION_COOKIE to a full signed cookie value obtained
 *     from a browser (DevTools → Application → Cookies → better-auth.session_token).
 *
 * `E2E_SESSION_TOKEN` (raw token) is NO LONGER accepted — it cannot authenticate.
 */

import { test as base, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitPanelPage } from './git-panel.page';

type GitFixtures = {
  gitPanel: GitPanelPage;
};

const BASE_URL =
  process.env.E2E_BASE_URL ||
  (process.env.E2E_REUSE_DEV === '1' ? 'http://localhost:3000' : 'http://localhost:3100');

// Fixed e2e account. In the isolated temp DB this is the bootstrap user
// (count===0 → signup allowed). Stable creds so a re-run signs IN if it exists.
const E2E_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-git@mentiko.test';
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD || 'e2e-git-pass-1234';

/**
 * Scratch git repo for the panel to mount on. Created fresh per worker in the
 * system tmp dir so branch/stash/commit mutations never touch a real checkout.
 */
function createScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mentiko-git-e2e-'));
  execSync('git init -q -b main', { cwd: dir });
  execSync('git config user.email e2e@mentiko.test', { cwd: dir });
  execSync('git config user.name "E2E"', { cwd: dir });
  execSync(`printf '# scratch\\n' > README.md`, { cwd: dir });
  execSync('git add README.md', { cwd: dir });
  execSync('git commit -q -m init', { cwd: dir });
  return dir;
}

/** Read the signed `better-auth.session_token` value from a Set-Cookie header. */
function extractSessionCookie(setCookie: string | null | undefined): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Obtain a legitimately-issued signed session cookie from the server.
 * Prefers E2E_SESSION_COOKIE (provided). Otherwise bootstraps via signup,
 * falling back to sign-in if the account already exists.
 */
async function mintSessionCookie(): Promise<string> {
  if (process.env.E2E_SESSION_COOKIE) return process.env.E2E_SESSION_COOKIE;

  const creds = { name: 'E2E Git', email: E2E_EMAIL, password: E2E_PASSWORD };

  // Try signup (works on a fresh/isolated DB via the bootstrap allowance).
  let res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  });
  let cookie = extractSessionCookie(res.headers.get('set-cookie'));
  if (cookie) return cookie;

  // Fallback: sign in (account already exists from a prior run / shared DB).
  res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
  });
  cookie = extractSessionCookie(res.headers.get('set-cookie'));
  if (cookie) return cookie;

  throw new Error(
    `git e2e: could not obtain a session cookie from ${BASE_URL}. ` +
      'Run in the default isolated mode (throwaway DB) or set E2E_SESSION_COOKIE ' +
      'to a signed cookie value from your browser (DevTools → Cookies).'
  );
}

export const test = base.extend<GitFixtures>({
  gitPanel: async ({ page }, use) => {
    const sessionCookie = await mintSessionCookie();
    const workspacePath = process.env.E2E_WORKSPACE_PATH || createScratchRepo();

    await page.context().addCookies([
      {
        name: 'better-auth.session_token',
        value: sessionCookie,
        url: BASE_URL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    // Config root + workspace list → the editor mounts the git panel on the
    // scratch repo (the workspace store would otherwise auto-pick a real one).
    await page.route('**/api/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { root: workspacePath } }),
      })
    );
    await page.route('**/api/workspaces**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ id: 'e2e-scratch', name: 'e2e-scratch', path: workspacePath }],
        }),
      })
    );

    const gitPanel = new GitPanelPage(page);
    await gitPanel.openGitPanel();
    await expect(gitPanel.branchTrigger).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(gitPanel);
  },
});

export { expect } from '@playwright/test';

export const TEST_BRANCHES = {
  feature: 'e2e-test-feature-branch',
  temp: 'e2e-test-temp-branch',
} as const;

export const TEST_STASHES = {
  basic: 'e2e test stash',
  withMessage: 'e2e stash with custom message',
} as const;

export const TEST_COMMITS = {
  basic: 'e2e: test commit message',
} as const;
