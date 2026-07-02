import { test, expect, TEST_BRANCHES } from './fixtures';
import type { Page } from '@playwright/test';

// ── mock helpers ───────────────────────────────────────────────────────────────

const MOCK_REQUEST_ID = 'mock-branch-test';

function makeSuccess(data: object): string {
  return JSON.stringify({ success: true, data, requestId: MOCK_REQUEST_ID });
}

interface MockBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  tracking?: string;
  lastCommit?: string;
  lastCommitDate?: string;
}

function branchListBody(branches: MockBranch[], current: string): string {
  return makeSuccess({ branches, current });
}

type ActionHandler = (
  action: string,
  body: Record<string, unknown>
) => Promise<{ status: number; body: string }>;

async function mockGitRoute(page: Page, handler: ActionHandler): Promise<void> {
  await page.route('**/api/git', async (route) => {
    const rawBody = route.request().postData() ?? '{}';
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const action = (body.action as string) ?? '';
    const { status, body: responseBody } = await handler(action, body);
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: responseBody,
    });
  });
}

// ── shared test data ───────────────────────────────────────────────────────────

const BRANCH_MAIN: MockBranch = {
  name: 'main',
  isCurrent: true,
  isRemote: false,
  lastCommitDate: '2 days ago',
};

const BRANCH_FEATURE: MockBranch = {
  name: TEST_BRANCHES.feature,
  isCurrent: false,
  isRemote: false,
  lastCommitDate: '1 day ago',
};

const BRANCH_TEMP: MockBranch = {
  name: TEST_BRANCHES.temp,
  isCurrent: false,
  isRemote: false,
  lastCommitDate: '3 hours ago',
};

// Default git status for page mount (prevents network errors on /code load)
const MOCK_STATUS = {
  branch: 'main',
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
};

// ── Branch listing ─────────────────────────────────────────────────────────────

test.describe('Branch listing', () => {
  test('opens branch dropdown and lists all branches', async ({ gitPanel, page }) => {
    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        return {
          status: 200,
          body: branchListBody([BRANCH_MAIN, BRANCH_FEATURE], 'main'),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    const branches = await gitPanel.listBranches();
    expect(branches).toContain('main');
    expect(branches).toContain(TEST_BRANCHES.feature);
    expect(branches.length).toBeGreaterThanOrEqual(2);
  });

  test('marks the currently active branch with data-is-current="true"', async ({
    gitPanel,
    page,
  }) => {
    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        return {
          status: 200,
          body: branchListBody([BRANCH_MAIN, BRANCH_FEATURE], 'main'),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    await gitPanel.openBranchDropdown();

    // current branch item must have data-is-current="true"
    const currentItem = page.locator('[data-is-current="true"]');
    await expect(currentItem).toBeVisible({ timeout: 5000 });
    expect(await currentItem.getAttribute('data-branch')).toBe('main');

    // non-current branch must NOT have data-is-current="true"
    const featureItem = page.locator(`[data-branch="${TEST_BRANCHES.feature}"]`);
    await expect(featureItem).toBeVisible();
    expect(await featureItem.getAttribute('data-is-current')).not.toBe('true');
  });
});

// ── Create branch ──────────────────────────────────────────────────────────────

test.describe('Create branch (success)', () => {
  test('creates a new branch and it appears in the dropdown list', async ({
    gitPanel,
    page,
  }) => {
    const newBranchName = TEST_BRANCHES.feature;
    let createdBranch = false;

    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        if (!createdBranch) {
          // Initial state — only main exists
          return {
            status: 200,
            body: branchListBody([BRANCH_MAIN], 'main'),
          };
        }
        // Post-create refresh — new branch now present
        return {
          status: 200,
          body: branchListBody([BRANCH_MAIN, { ...BRANCH_FEATURE, isCurrent: false }], 'main'),
        };
      }
      if (action === 'create_branch') {
        createdBranch = true;
        return {
          status: 200,
          body: makeSuccess({ ok: true, branch: newBranchName, current: 'main' }),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    // Create the branch via the POM method
    await gitPanel.createBranch(newBranchName);

    // After creation the component calls refreshBranches() — re-open dropdown
    // to verify the new branch is present
    await gitPanel.openBranchDropdown();
    await expect(page.locator(`[data-branch="${newBranchName}"]`)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Create branch (duplicate name error)', () => {
  test('shows client-side validation error and disables create button', async ({
    gitPanel,
    page,
  }) => {
    const existingBranchName = TEST_BRANCHES.feature;

    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        return {
          status: 200,
          body: branchListBody([BRANCH_MAIN, BRANCH_FEATURE], 'main'),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    // Open dropdown so branches are loaded into state
    await gitPanel.openBranchDropdown();
    await expect(page.locator(`[data-branch="${existingBranchName}"]`)).toBeVisible({ timeout: 5000 });

    // Type the name of an already-existing branch
    const input = page.locator('input[placeholder="New branch name…"]');
    await input.fill(existingBranchName);

    // Client-side validation must show "Branch already exists" inline
    await expect(page.locator('text=Branch already exists')).toBeVisible({ timeout: 3000 });

    // The Create button must be disabled (canCreateBranch is false)
    const createBtn = page.locator('button[type="submit"]:has-text("Create")');
    await expect(createBtn).toBeDisabled();
  });
});

// ── Switch branch ──────────────────────────────────────────────────────────────

test.describe('Switch branch', () => {
  test('switches to another branch and updates the active indicator', async ({
    gitPanel,
    page,
  }) => {
    let switched = false;

    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        if (!switched) {
          return {
            status: 200,
            body: branchListBody([BRANCH_MAIN, BRANCH_FEATURE], 'main'),
          };
        }
        // After switch: feature is now current
        return {
          status: 200,
          body: branchListBody(
            [
              { ...BRANCH_MAIN, isCurrent: false },
              { ...BRANCH_FEATURE, isCurrent: true },
            ],
            TEST_BRANCHES.feature
          ),
        };
      }
      if (action === 'switch_branch') {
        switched = true;
        return {
          status: 200,
          body: makeSuccess({
            ok: true,
            current: TEST_BRANCHES.feature,
            previous: 'main',
            hasUncommittedChanges: false,
          }),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    // Verify initial current branch before switch
    await gitPanel.openBranchDropdown();
    await expect(page.locator('[data-branch="main"][data-is-current="true"]')).toBeVisible({
      timeout: 5000,
    });

    // Perform the switch (closes dropdown and re-opens internally)
    await page.keyboard.press('Escape');
    await gitPanel.switchBranch(TEST_BRANCHES.feature);

    // Re-open to verify the active indicator updated
    await gitPanel.openBranchDropdown();
    await expect(
      page.locator(`[data-branch="${TEST_BRANCHES.feature}"][data-is-current="true"]`)
    ).toBeVisible({ timeout: 5000 });

    // Old current branch must no longer be marked active
    const mainItem = page.locator('[data-branch="main"]');
    await expect(mainItem).toBeVisible();
    expect(await mainItem.getAttribute('data-is-current')).toBe('false');
  });
});

// ── Delete branch ──────────────────────────────────────────────────────────────

test.describe('Delete branch (success)', () => {
  test('deletes a non-current branch and removes it from the list', async ({
    gitPanel,
    page,
  }) => {
    let deleted = false;

    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        if (!deleted) {
          return {
            status: 200,
            body: branchListBody([BRANCH_MAIN, BRANCH_TEMP], 'main'),
          };
        }
        // After deletion only main remains
        return {
          status: 200,
          body: branchListBody([BRANCH_MAIN], 'main'),
        };
      }
      if (action === 'delete_branch') {
        deleted = true;
        return {
          status: 200,
          body: makeSuccess({ ok: true, deleted: TEST_BRANCHES.temp }),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    // Confirm the branch is visible before deleting
    await gitPanel.openBranchDropdown();
    await expect(page.locator(`[data-branch="${TEST_BRANCHES.temp}"]`)).toBeVisible({
      timeout: 5000,
    });
    await page.keyboard.press('Escape');

    // Delete the temp branch
    await gitPanel.deleteBranch(TEST_BRANCHES.temp);

    // Re-open and confirm the branch is gone
    await gitPanel.openBranchDropdown();
    await expect(page.locator(`[data-branch="${TEST_BRANCHES.temp}"]`)).not.toBeVisible();

    // The current branch (main) should still be present
    await expect(page.locator('[data-branch="main"]')).toBeVisible();
  });
});

test.describe('Delete branch (current branch protection)', () => {
  test('shows an error when the user tries to delete the active branch', async ({
    gitPanel,
    page,
  }) => {
    await mockGitRoute(page, async (action) => {
      if (action === 'list_branches') {
        return {
          status: 200,
          body: branchListBody([BRANCH_MAIN, BRANCH_FEATURE], 'main'),
        };
      }
      if (action === 'delete_branch') {
        // API rejects deletion of checked-out branch
        return {
          status: 200,
          body: makeSuccess({
            ok: false,
            error:
              'Cannot delete the currently checked-out branch. Switch to another branch first.',
          }),
        };
      }
      if (action === 'status') {
        return { status: 200, body: makeSuccess(MOCK_STATUS) };
      }
      return { status: 200, body: makeSuccess({}) };
    });

    // Open the dropdown so branches load
    await gitPanel.openBranchDropdown();
    await expect(page.locator('[data-branch="main"]')).toBeVisible({ timeout: 5000 });

    // Click the delete icon on the current branch (main)
    await page.locator('button[aria-label="Delete branch main"]').click();

    // Confirmation dialog must appear
    const dialog = page.locator('[role="dialog"][aria-label="Delete branch confirmation"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Confirm the deletion — the API will reject it
    await dialog.locator('button:has-text("Delete")').click();
    await page.waitForResponse('**/api/git');

    // Error message must be visible somewhere on the page
    await expect(
      page.locator('text=Cannot delete the currently checked-out branch')
    ).toBeVisible({ timeout: 5000 });
  });
});
