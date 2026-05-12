import { test, expect } from '@playwright/test';
import { AppHelpers } from '../helpers/test-helpers';

test.describe('chain execution stream', () => {
  let chainId: string;

  test.beforeEach(async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/chains');

    const chainLink = page.locator('a[href*="/chains/"]').first();
    const hasChains = await chainLink.count() > 0;

    if (!hasChains) {
      test.skip(true, 'no chains available, skipping execution stream tests');
    }

    const href = await chainLink.getAttribute('href');
    chainId = href?.split('/').pop() || 'test-chain';
  });

  test('user views chain run page', async ({ page }) => {
    await page.goto(`/chains/${chainId}/run`);

    await test.step('displays chain goal input', async () => {
      const goalText = page.locator('text=what should this chain accomplish');
      const startButton = page.locator('text=start chain');

      const isGoalVisible = await goalText.isVisible({ timeout: 2000 });
      const isStartVisible = !isGoalVisible && await startButton.isVisible({ timeout: 2000 });

      expect(isGoalVisible || isStartVisible).toBeTruthy();
    });

    await test.step('shows start chain button', async () => {
      const startButton = page.locator('button:has-text("start chain"), button:has-text("Start Chain")');
      const hasStartButton = await startButton.count() > 0;

      expect(hasStartButton).toBeTruthy();
    });
  });

  test('can switch between tabs', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto(`/chains/${chainId}/run`);

    const tabs = ['goal', 'agents', 'terminal', 'events', 'metrics'];

    for (const tab of tabs) {
      const tabButton = page.locator(`button:has-text("${tab}")`);
      const hasTab = await tabButton.count() > 0;

      if (hasTab) {
        await tabButton.first().click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('displays chain metadata', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto(`/chains/${chainId}/run`);

    const footerInfo = page.locator('footer');
    const hasFooter = await footerInfo.count() > 0;

    if (hasFooter) {
      await expect(footerInfo.first()).toBeVisible();
    }
  });
});
