/**
 * E2E tests: Stash Operations
 *
 * Covers: create, apply (success + conflict), drop, and empty-state.
 * Uses page.route() to intercept /api/git requests for conflict and
 * error scenarios so tests are deterministic and isolated from git state.
 *
 * Selector reference: web/components/editor/stash-selector.tsx
 */

import { test, expect, TEST_STASHES } from './fixtures';

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Wrap a value in the shape apiSuccess() produces so route interception
 * looks identical to a real server response.
 */
function apiOk<T>(data: T) {
  return { success: true, data };
}

/** Intercept every POST /api/git and respond with `body` once. */
async function interceptGit(
  page: import('@playwright/test').Page,
  matcher: (body: Record<string, unknown>) => boolean,
  response: unknown,
) {
  await page.route('**/api/git', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') { await route.continue(); return; }
    let body: Record<string, unknown>;
    try { body = JSON.parse(req.postData() ?? '{}'); } catch { body = {}; }

    if (matcher(body)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    } else {
      await route.continue();
    }
  });
}

// ── stubs: minimal stash objects ───────────────────────────────────────────────

const STASH_0 = {
  id: '0',
  branch: 'main',
  message: TEST_STASHES.basic,
  date: '2 minutes ago',
  commitHash: 'abc1234',
};

const STASH_1 = {
  id: '1',
  branch: 'main',
  message: TEST_STASHES.withMessage,
  date: '10 minutes ago',
  commitHash: 'def5678',
};

// ── test suite ─────────────────────────────────────────────────────────────────

test.describe('Stash Operations', () => {

  // ── 1. Create stash ──────────────────────────────────────────────────────────

  test('Create stash (success)', async ({ gitPanel, page }) => {
    await test.step('mock list_stashes to return empty, then one stash', async () => {
      let stashCreated = false;

      await page.route('**/api/git', async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') { await route.continue(); return; }
        let body: Record<string, unknown>;
        try { body = JSON.parse(req.postData() ?? '{}'); } catch { body = {}; }

        if (body.action === 'create_stash') {
          stashCreated = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({ ok: true, stashId: 'stash@{0}', message: TEST_STASHES.basic })),
          });
        } else if (body.action === 'list_stashes') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({ ok: true, stashes: stashCreated ? [STASH_0] : [] })),
          });
        } else {
          await route.continue();
        }
      });
    });

    await test.step('navigate to stash tab', async () => {
      await gitPanel.stashTab.click();
    });

    await test.step('open create stash dialog', async () => {
      await expect(gitPanel.createStashButton).toBeVisible({ timeout: 5000 });
      await gitPanel.createStashButton.click();

      const dialog = page.locator('[role="dialog"][aria-labelledby="create-stash-dialog-title"]');
      await expect(dialog).toBeVisible({ timeout: 3000 });
    });

    await test.step('fill message and confirm', async () => {
      const dialog = page.locator('[role="dialog"][aria-labelledby="create-stash-dialog-title"]');
      await dialog.locator('textarea#create-stash-message').fill(TEST_STASHES.basic);
      await dialog.locator('button:has-text("Create")').click();
    });

    await test.step('stash appears in list and dialog closes', async () => {
      await expect(
        page.locator('[role="dialog"][aria-labelledby="create-stash-dialog-title"]'),
      ).not.toBeVisible({ timeout: 5000 });

      await expect(gitPanel.stashList).toBeVisible({ timeout: 5000 });
      await expect(
        gitPanel.stashList.locator('[role="listitem"]'),
      ).toHaveCount(1, { timeout: 5000 });

      await expect(
        gitPanel.stashList.locator('[role="listitem"]').first(),
      ).toContainText(TEST_STASHES.basic);
    });
  });

  // ── 2. Apply stash (success) ─────────────────────────────────────────────────

  test('Apply stash (success)', async ({ gitPanel, page }) => {
    await test.step('mock list_stashes and apply_stash', async () => {
      await page.route('**/api/git', async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') { await route.continue(); return; }
        let body: Record<string, unknown>;
        try { body = JSON.parse(req.postData() ?? '{}'); } catch { body = {}; }

        if (body.action === 'list_stashes') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({ ok: true, stashes: [STASH_0] })),
          });
        } else if (body.action === 'apply_stash') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({
              ok: true,
              appliedStashId: 'stash@{0}',
              conflicts: [],
              conflictCount: 0,
            })),
          });
        } else {
          await route.continue();
        }
      });
    });

    await test.step('switch to stash tab and verify stash row', async () => {
      await gitPanel.stashTab.click();
      await expect(gitPanel.stashList).toBeVisible({ timeout: 5000 });
      await expect(gitPanel.stashList.locator('[role="listitem"]')).toHaveCount(1);
    });

    await test.step('hover stash row and click apply', async () => {
      const row = gitPanel.stashList.locator('[role="listitem"]').first();
      await row.hover();
      const applyBtn = row.locator('button[aria-label^="Apply"]');
      await expect(applyBtn).toBeVisible({ timeout: 3000 });
      await applyBtn.click();
    });

    await test.step('apply dialog shows success state', async () => {
      const applyDialog = page.locator('[role="dialog"][aria-labelledby="apply-stash-dialog-title"]');
      await expect(applyDialog).toBeVisible({ timeout: 5000 });

      // No conflict warning — success message visible
      await expect(applyDialog.locator('[role="status"]:has-text("applied successfully"), text=applied successfully')).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step('stash list is unchanged after apply (stash stays)', async () => {
      const applyDialog = page.locator('[role="dialog"][aria-labelledby="apply-stash-dialog-title"]');
      // Close the dialog
      await applyDialog.locator('button:has-text("Close")').click();
      // The stash remains in the list (apply does not drop)
      await expect(gitPanel.stashList.locator('[role="listitem"]')).toHaveCount(1, { timeout: 5000 });
    });
  });

  // ── 3. Apply stash (conflict scenario) ──────────────────────────────────────

  test('Apply stash (conflict scenario)', async ({ gitPanel, page }) => {
    const conflictFiles = ['src/lib/auth.ts', 'src/components/Button.tsx'];

    await test.step('set up route interception for conflict response', async () => {
      await page.route('**/api/git', async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') { await route.continue(); return; }
        let body: Record<string, unknown>;
        try { body = JSON.parse(req.postData() ?? '{}'); } catch { body = {}; }

        if (body.action === 'list_stashes') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({ ok: true, stashes: [STASH_0] })),
          });
        } else if (body.action === 'apply_stash') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({
              ok: false,
              appliedStashId: 'stash@{0}',
              conflicts: conflictFiles,
              conflictCount: conflictFiles.length,
              hasUnmergedPaths: true,
              error: 'Merge conflicts during stash apply. Resolve conflicts and commit.',
            })),
          });
        } else {
          await route.continue();
        }
      });
    });

    await test.step('navigate to stash tab', async () => {
      await gitPanel.stashTab.click();
      await expect(gitPanel.stashList).toBeVisible({ timeout: 5000 });
    });

    await test.step('trigger apply on the stash row', async () => {
      const row = gitPanel.stashList.locator('[role="listitem"]').first();
      await row.hover();
      const applyBtn = row.locator('button[aria-label^="Apply"]');
      await expect(applyBtn).toBeVisible({ timeout: 3000 });
      await applyBtn.click();
    });

    await test.step('apply dialog shows conflict warning', async () => {
      const applyDialog = page.locator('[role="dialog"][aria-labelledby="apply-stash-dialog-title"]');
      await expect(applyDialog).toBeVisible({ timeout: 5000 });

      // Conflict badge present
      const conflictBadge = applyDialog.locator('[role="alert"]').filter({ hasText: /conflict/i });
      await expect(conflictBadge).toBeVisible({ timeout: 5000 });
    });

    await test.step('conflicting file paths are listed in the dialog', async () => {
      const applyDialog = page.locator('[role="dialog"][aria-labelledby="apply-stash-dialog-title"]');

      for (const file of conflictFiles) {
        await expect(applyDialog.locator(`text=${file}`)).toBeVisible({ timeout: 3000 });
      }
    });

    await test.step('dialog title changes to indicate conflicts', async () => {
      const dialogTitle = page.locator('#apply-stash-dialog-title');
      await expect(dialogTitle).toContainText('Conflicts Detected', { timeout: 3000 });
    });

    await test.step('resolution steps are shown', async () => {
      const applyDialog = page.locator('[role="dialog"][aria-labelledby="apply-stash-dialog-title"]');
      await expect(applyDialog.locator('text=Resolution Steps')).toBeVisible({ timeout: 3000 });
    });
  });

  // ── 4. Drop stash (success) ──────────────────────────────────────────────────

  test('Drop stash (success)', async ({ gitPanel, page }) => {
    let stashDropped = false;

    await test.step('mock list_stashes and drop_stash', async () => {
      await page.route('**/api/git', async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') { await route.continue(); return; }
        let body: Record<string, unknown>;
        try { body = JSON.parse(req.postData() ?? '{}'); } catch { body = {}; }

        if (body.action === 'list_stashes') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({ ok: true, stashes: stashDropped ? [] : [STASH_0] })),
          });
        } else if (body.action === 'drop_stash') {
          stashDropped = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apiOk({ ok: true, droppedId: 'stash@{0}' })),
          });
        } else {
          await route.continue();
        }
      });
    });

    await test.step('switch to stash tab and verify stash exists', async () => {
      await gitPanel.stashTab.click();
      await expect(gitPanel.stashList).toBeVisible({ timeout: 5000 });
      await expect(gitPanel.stashList.locator('[role="listitem"]')).toHaveCount(1);
    });

    await test.step('hover row and click delete button', async () => {
      const row = gitPanel.stashList.locator('[role="listitem"]').first();
      await row.hover();
      const dropBtn = row.locator('button[aria-label^="Delete"]');
      await expect(dropBtn).toBeVisible({ timeout: 3000 });
      await dropBtn.click();
    });

    await test.step('confirm drop in dialog', async () => {
      const dialog = page.locator('[role="dialog"][aria-labelledby="drop-stash-dialog-title"]');
      await expect(dialog).toBeVisible({ timeout: 3000 });

      // Dialog shows the stash message in the confirmation
      await expect(dialog).toContainText(TEST_STASHES.basic);

      await dialog.locator('button:has-text("Delete")').click();
    });

    await test.step('stash is removed from the list', async () => {
      await expect(
        page.locator('[role="dialog"][aria-labelledby="drop-stash-dialog-title"]'),
      ).not.toBeVisible({ timeout: 5000 });

      // After drop the list should show empty state
      await expect(
        page.locator('text=No stashes yet'),
      ).toBeVisible({ timeout: 5000 });
    });
  });

  // ── 5. Stash list empty state ────────────────────────────────────────────────

  test('Stash list empty state', async ({ gitPanel, page }) => {
    await test.step('mock list_stashes to return empty array', async () => {
      await interceptGit(
        page,
        (body) => body.action === 'list_stashes',
        apiOk({ ok: true, stashes: [] }),
      );
    });

    await test.step('switch to stash tab', async () => {
      await gitPanel.stashTab.click();
    });

    await test.step('empty state message is visible', async () => {
      await expect(page.locator('text=No stashes yet')).toBeVisible({ timeout: 5000 });
    });

    await test.step('create stash button is still accessible', async () => {
      await expect(gitPanel.createStashButton).toBeVisible({ timeout: 3000 });
    });

    await test.step('stash list element is not rendered (no items)', async () => {
      // The [role="list"] only renders when stashes.length > 0
      await expect(page.locator('[role="list"][aria-label="Git stashes"]')).not.toBeVisible();
    });
  });

  // ── 6. Multiple stashes — verifies list renders correctly ───────────────────

  test('Stash list renders multiple stashes', async ({ gitPanel, page }) => {
    await test.step('mock list_stashes to return two stashes', async () => {
      await interceptGit(
        page,
        (body) => body.action === 'list_stashes',
        apiOk({ ok: true, stashes: [STASH_0, STASH_1] }),
      );
    });

    await test.step('switch to stash tab', async () => {
      await gitPanel.stashTab.click();
      await expect(gitPanel.stashList).toBeVisible({ timeout: 5000 });
    });

    await test.step('both stashes appear in the list', async () => {
      const rows = gitPanel.stashList.locator('[role="listitem"]');
      await expect(rows).toHaveCount(2, { timeout: 5000 });
      await expect(rows.nth(0)).toContainText(TEST_STASHES.basic);
      await expect(rows.nth(1)).toContainText(TEST_STASHES.withMessage);
    });

    await test.step('header count reflects two stashes', async () => {
      // The header reads "2 stashes" (aria-live region)
      await expect(page.locator('span[aria-live="polite"]').filter({ hasText: '2 stashes' })).toBeVisible({
        timeout: 3000,
      });
    });
  });

});
