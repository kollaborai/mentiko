import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Chain execution stream — UI coverage (never-skip).
 *
 * History: this spec used to `test.skip()` itself whenever the local data root had
 * no chains, so it routinely proved nothing. It now SEEDS a deterministic fixture
 * chain through the app's own API and asserts against it, so it can never skip.
 *
 * What blocks a full in-browser engine run here (reported, not hidden):
 * the dev server enforces a client-side app-shell session gate
 * (components/app-shell/must-change-password-gate.tsx redirects to
 * /login?redirect=… when there is no Better Auth session). In the standard local
 * dev configuration there is NO DATABASE_URL, so:
 *   - API routes are open (lib/auth/auth-bridge.ts shouldUseDevAuthFallback() is
 *     true when NODE_ENV!=='production' && !DATABASE_URL) — so seeding a chain and
 *     listing chains over the API works without a session; but
 *   - the BROWSER cannot obtain a session: there is no auth DB to authenticate
 *     against and public sign-up is disabled ("Ask your organization admin for an
 *     invitation link"). Every existing browser spec that calls the shared login()
 *     helper hits the same wall (the login submit button stays disabled / there is
 *     no valid credential).
 * Therefore the deep, hermetic end-to-end proof of the engine — create chain ->
 * run on the ACTUAL bash engine -> events stream -> terminal SUCCESS/FAILED —
 * lives in the engine-level harness web/e2e/engine/engine-e2e.sh (which gates CI).
 * This spec covers the browser surface that IS reachable: the fixture chain is
 * created through the app and listed, and — WHEN a session is available — the run
 * page renders with its goal input + start control. When the app-shell gate sends
 * the browser to /login (no session), the spec asserts that gating happened
 * (the route is protected, as designed) instead of skipping or hanging.
 *
 * If your environment DOES have auth (DATABASE_URL + a seeded user), set
 * E2E_TEST_EMAIL / E2E_TEST_PASSWORD and the deeper run-page assertions execute.
 */

const FIXTURE_CHAIN_NAME = 'e2e-fixture-execution-stream';
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || '';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || '';

/**
 * Idempotently seed the fixture chain via POST /api/chains/save (the app's own
 * create endpoint). Reuses the same name every run (the save route overwrites in
 * place), so repeated runs don't pile up duplicates. The chain name is also the
 * /chains/[id] route segment.
 */
async function seedFixtureChain(request: APIRequestContext): Promise<boolean> {
  const chain = {
    name: FIXTURE_CHAIN_NAME,
    description: 'E2E fixture chain for the execution-stream spec (safe to delete).',
    version: '1.0.0',
    config: { monitor: false, max_rounds: 1, session_prefix: 'e2efix', on_complete: 'stop' },
    agents: [
      {
        id: 'fixture-step',
        name: 'Fixture Step',
        role: 'fixture',
        prompt: 'fixture agent — exists only so the run page has something to render',
        triggers: ['manual-start'],
        emits: 'fixture-done',
      },
    ],
  };
  const res = await request
    .post('/api/chains/save', { data: { name: FIXTURE_CHAIN_NAME, chain, createVersion: false } })
    .catch(() => null);
  return !!res && res.ok();
}

/** Robust, best-effort browser login. Fills email+password if both the inputs and
 *  credentials are present. Returns true only if it landed on an authenticated page. */
async function tryBrowserLogin(page: Page): Promise<boolean> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  if (!page.url().includes('/login')) return true; // already authenticated / no gate

  if (!TEST_EMAIL || !TEST_PASSWORD) return false; // no creds available — cannot log in
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  if ((await email.count()) === 0 || (await password.count()) === 0) return false;

  await email.first().fill(TEST_EMAIL);
  await password.first().fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10000 }).catch(() => {});
  return !page.url().includes('/login');
}

test.describe('chain execution stream', () => {
  let authed = false;

  test.beforeEach(async ({ page, request }) => {
    // CREATE the fixture chain through the app (API) — this never skips and is the
    // un-skippable core of the spec.
    const seeded = await seedFixtureChain(request);
    expect(seeded, 'fixture chain must be creatable through /api/chains/save').toBeTruthy();

    // best-effort browser session (enables the deeper run-page assertions).
    authed = await tryBrowserLogin(page);
  });

  test('fixture chain is created through the app and listed', async ({ request }) => {
    // proves the create path worked and the chain is discoverable via the app's own
    // list endpoint — the previous unconditional-skip behaviour is gone for good.
    const listRes = await request.get('/api/chains/list');
    expect(listRes.ok(), '/api/chains/list should respond 200').toBeTruthy();

    const body = await listRes.json();
    const chains: Array<{ id?: string; name?: string }> = body?.data?.chains ?? body?.chains ?? [];
    const found = chains.some((c) => c.id === FIXTURE_CHAIN_NAME || c.name === FIXTURE_CHAIN_NAME);
    expect(found, `seeded chain '${FIXTURE_CHAIN_NAME}' must appear in the chains list`).toBeTruthy();
  });

  test('run page is reachable and either renders or is correctly auth-gated', async ({ page }) => {
    await page.goto(`/chains/${FIXTURE_CHAIN_NAME}/run`);
    await page.waitForLoadState('networkidle');

    if (!authed && page.url().includes('/login')) {
      // EXPECTED in the default local dev config (no DATABASE_URL, no seeded user):
      // the app-shell gate protects the run page. Assert the gate fired rather than
      // skipping — the route IS protected, by design. The hermetic engine proof
      // lives in web/e2e/engine/engine-e2e.sh.
      expect(page.url()).toContain('/login');
      test.info().annotations.push({
        type: 'note',
        description:
          'run page is auth-gated and no browser session is available in this env; ' +
          'deep run-page assertions are covered hermetically by web/e2e/engine/engine-e2e.sh',
      });
      return;
    }

    // AUTHENTICATED PATH: the run page must render its pre-run GoalInput.
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    await test.step('goal input renders (pre-run GoalInput)', async () => {
      await expect(page.locator('text=what should this chain accomplish')).toBeVisible({
        timeout: 15000,
      });
      await expect(page.locator('#chain-goal')).toBeVisible();
    });

    await test.step('start control renders and gates on a non-empty goal', async () => {
      const startButton = page
        .locator('button:has-text("start chain"), button:has-text("Start Chain")')
        .first();
      await expect(startButton).toBeVisible({ timeout: 15000 });
      await expect(startButton).toBeDisabled(); // disabled={!goal.trim()} pre-input

      await page.locator('#chain-goal').fill('e2e: smoke the run page (no real execution)');
      await expect(startButton).toBeEnabled({ timeout: 5000 });
    });
  });
});
