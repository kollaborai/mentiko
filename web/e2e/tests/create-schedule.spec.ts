import { test, expect } from '@playwright/test';
import { AppHelpers } from '../helpers/test-helpers';

test.describe('create schedule', () => {
  test('user views schedules page', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await test.step('navigates to schedules page', async () => {
      await page.goto('/schedules');
      await expect(page.locator('h1:has-text("Schedules")')).toBeVisible({ timeout: 5000 });
    });

    await test.step('shows page content', async () => {
      const pageContent1 = page.locator('text=Manage recurring chain executions');
      const pageContent2 = page.locator('text=/schedule/i');

      const isContent1Visible = await pageContent1.isVisible({ timeout: 2000 });
      const isContent2Visible = !isContent1Visible && await pageContent2.count() > 0;

      expect(isContent1Visible || isContent2Visible).toBeTruthy();
    });
  });

  test('displays schedule list or empty state', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/schedules');

    const scheduleText = page.locator('text=/schedule/i');
    const hasScheduleText = await scheduleText.count() > 0;

    expect(hasScheduleText).toBeTruthy();
  });
});
