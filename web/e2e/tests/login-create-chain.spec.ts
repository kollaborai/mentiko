import { test, expect } from '@playwright/test';
import { AppHelpers } from '../helpers/test-helpers';

test.describe('login and create chain', () => {
  test('user logs in and navigates to chains', async ({ page }) => {
    const helpers = new AppHelpers(page);

    const authEnabled = await helpers.isAuthEnabled();

    await test.step('logs in if auth is enabled', async () => {
      if (authEnabled) {
        await page.goto('/login');
        await expect(page.locator('h1')).toContainText('mentiko');
        await expect(page.locator('text=Enter your password')).toBeVisible();

        await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD || 'test-password');
        await page.click('button[type="submit"]');

        await page.waitForURL('/', { timeout: 10000 });
        expect(page.url()).toBe('http://localhost:3000/');
      } else {
        await page.goto('/');
        await expect(page).toHaveURL('http://localhost:3000/');
      }
    });

    await test.step('navigates to chains page', async () => {
      await page.goto('/chains');
      await expect(page.locator('h1')).toContainText('Chains', { timeout: 5000 });
    });
  });

  test('user creates a new chain via form', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await test.step('navigates to create chain page', async () => {
      await page.click('a[href="/chains/new"]');
      await page.waitForURL('/chains/new');
      await expect(page.locator('h1')).toContainText('Create Chain');
    });

    await test.step('shows chain form elements', async () => {
      const promptInput = page.locator('textarea#prompt');
      await expect(promptInput).toBeVisible();

      const exampleButtons = page.locator('button').filter({ hasText: /research|write|code/i });
      const hasExamples = await exampleButtons.count() > 0;

      if (hasExamples) {
        await expect(exampleButtons.first()).toBeVisible();
      }
    });

    await test.step('attempts to generate chain', async () => {
      const prompt = 'Create a simple test chain';

      await page.locator('textarea#prompt').fill(prompt);

      const generateButton = page.locator('button:has-text("Generate Chain")');
      await generateButton.click();

      await page.waitForTimeout(3000);

      const onPage = page.url().includes('/chains/new');
      expect(onPage).toBeTruthy();
    });
  });

  test('shows error with invalid password when auth enabled', async ({ page }) => {
    const helpers = new AppHelpers(page);
    const authEnabled = await helpers.isAuthEnabled();

    test.skip(!authEnabled, 'auth is disabled, skipping invalid password test');

    await page.goto('/login');

    await page.fill('input[type="password"]', 'wrong-password');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Invalid password')).toBeVisible({ timeout: 5000 });
    expect(page.url()).toContain('/login');
  });

  test('redirects to login when auth enabled', async ({ page }) => {
    const helpers = new AppHelpers(page);
    const authEnabled = await helpers.isAuthEnabled();

    test.skip(!authEnabled, 'auth is disabled, skipping redirect test');

    await page.goto('/chains');
    await page.waitForURL(/\/login/, { timeout: 5000 });
    expect(page.url()).toContain('/login');
  });
});
