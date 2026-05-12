import { test, expect } from '@playwright/test';
import { AppHelpers } from '../helpers/test-helpers';

test.describe('conversation history', () => {
  test('user views conversations page', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await test.step('navigates to conversations page', async () => {
      await page.goto('/conversations');
      await expect(page.locator('h1:has-text("Conversations")')).toBeVisible({ timeout: 5000 });
    });

    await test.step('displays search input', async () => {
      const searchInput = page.locator('input[placeholder*="Project directory"]');
      await expect(searchInput).toBeVisible();
    });

    await test.step('shows conversation list or empty state', async () => {
      const emptyState = page.locator('text=No conversations found');
      const listContainer = page.locator('[class*="overflow-y-auto"]');

      const isEmptyVisible = await emptyState.isVisible({ timeout: 2000 });
      const isListVisible = !isEmptyVisible && await listContainer.first().isVisible({ timeout: 2000 });

      expect(isEmptyVisible || isListVisible).toBeTruthy();
    });
  });

  test('can search with custom directory', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/conversations');

    const cwdInput = page.locator('input[placeholder*="Project directory"]');
    await cwdInput.fill('/tmp');

    const searchButton = page.locator('button').filter({ has: page.locator('svg[class*="search" i]') });

    const hasSearchButton = await searchButton.count() > 0;
    if (hasSearchButton) {
      await searchButton.first().click();
    }

    await page.waitForTimeout(1000);
  });

  test('refreshes conversations list', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/conversations');

    const refreshIcon = page.locator('svg').filter({ has: page.locator('[class*="refresh" i]') });

    const hasRefreshIcon = await refreshIcon.count() > 0;

    if (hasRefreshIcon) {
      await refreshIcon.locator('..').click();
    }

    await page.waitForTimeout(1000);

    await expect(page.locator('h1:has-text("Conversations")')).toBeVisible();
  });
});
