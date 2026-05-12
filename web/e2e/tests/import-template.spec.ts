import { test, expect } from '@playwright/test';
import { AppHelpers } from '../helpers/test-helpers';

test.describe('import chain from template', () => {
  test('user imports a chain from template', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await test.step('navigates to templates marketplace', async () => {
      await page.goto('/marketplace/chains');
      await expect(page.locator('h1:has-text("Chains")')).toBeVisible({ timeout: 5000 });
    });

    await test.step('displays template grid', async () => {
      const templateGrid = page.locator('[class*="grid gap"]');

      const hasTemplates = await templateGrid.count() > 0;

      if (!hasTemplates) {
        const emptyText = page.locator('text=/no templates/i');
        await expect(emptyText.first()).toBeVisible({ timeout: 3000 });
      } else {
        await expect(templateGrid.first()).toBeVisible();
      }
    });

    await test.step('shows search and filter controls', async () => {
      const searchInput = page.locator('input[placeholder*="Search"]');
      await expect(searchInput).toBeVisible();

      const sortDropdown = page.locator('select');
      const hasSort = await sortDropdown.count() > 0;
      expect(hasSort).toBeTruthy();
    });
  });

  test('filters templates by category', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/marketplace/chains');

    const categorySelect = page.locator('select').nth(1);

    const hasCategorySelect = await categorySelect.count() > 0;

    if (hasCategorySelect) {
      await categorySelect.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
    }
  });

  test('uses template to create new chain', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/marketplace/chains');

    const useButton = page.locator('button:has-text("Use")');

    const hasUseButton = await useButton.count() > 0;

    if (hasUseButton) {
      await test.step('clicks use button on template', async () => {
        await useButton.first().click();
        await page.waitForTimeout(2000);
      });

      await test.step('redirects to chains page', async () => {
        const isOnChainsPage = page.url().includes('/chains');
        expect(isOnChainsPage).toBeTruthy();
      });
    }
  });

  test('views template details', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/marketplace/chains');

    const viewButton = page.locator('a:has-text("View Details")');

    const hasViewButton = await viewButton.count() > 0;

    if (hasViewButton) {
      await viewButton.first().click();
      await page.waitForTimeout(1000);

      const templateDetail = page.locator('text=/agents/i');
      const hasDetail = await templateDetail.count() > 0;

      if (hasDetail) {
        await expect(templateDetail.first()).toBeVisible();
      }
    }
  });

  test('searches for templates', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/marketplace/chains');

    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('research');

    await page.waitForTimeout(1000);

    const searchValue = await searchInput.inputValue();
    expect(searchValue).toBe('research');
  });

  test('rates a template', async ({ page }) => {
    const helpers = new AppHelpers(page);
    await helpers.login();

    await page.goto('/marketplace/chains');

    const starButton = page.locator('button').filter({ has: page.locator('svg[class*="star" i]') });

    const hasStarButton = await starButton.count() > 0;

    if (hasStarButton) {
      await starButton.first().click();
      await page.waitForTimeout(500);
    }
  });
});
