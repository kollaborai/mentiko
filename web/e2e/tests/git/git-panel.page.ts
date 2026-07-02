import { Page, Locator, expect } from '@playwright/test';

/**
 * GitPanelPage — Page Object Model for the Mentiko Git workflow interface.
 *
 * The Git panel lives in the code editor at /code (the `GitPanel` component
 * rendered in the right sidebar). All selectors are derived from inspecting:
 *   web/components/editor/git-panel.tsx
 *   web/components/editor/branch-selector.tsx
 *   web/components/editor/stash-selector.tsx
 *   web/components/git/review-panel-section.tsx
 *   web/components/git/review-assignment-dialog.tsx
 *   web/components/git/review-status-badge.tsx
 *
 * SELECTOR MAP
 * ──────────────────────────────────────────────────────────────────────────
 * BranchSelector (branch-selector.tsx)
 *   trigger button     [data-testid="branch-selector-trigger"]
 *   branch menu        [role="menu"][aria-label="Available branches"]
 *   branch item        [data-branch="<name>"] (DropdownMenuItem attribute)
 *   current indicator  [data-is-current="true"]
 *   new branch input   input[placeholder="New branch name…"]
 *   create submit      button[type="submit"]:has-text("Create")
 *   delete icon        button[aria-label="Delete branch <name>"]
 *   delete dialog      [role="dialog"][aria-label="Delete branch confirmation"]
 *   confirm delete     button:has-text("Delete") | button:has-text("Force Delete")
 *
 * GitPanel view tabs (git-panel.tsx)
 *   changes tab        button[title="Changes"]
 *   stash tab          button[title="Stashes"]
 *   log tab            button[title="Log"]
 *   review tab         button[title="Review"]
 *   refresh button     button[title="Refresh"]
 *
 * File rows (git-panel.tsx — FileRow component)
 *   file row wrapper   .group.flex.items-center (hover triggers action buttons)
 *   status badge       span.font-mono.font-bold.w-3 (text: M/A/D/R/U)
 *   file name          span.flex-1.font-mono
 *   stage button       button[title="Stage file"]   (hover-visible)
 *   unstage button     button[title="Unstage file"] (hover-visible)
 *
 * Section headers
 *   staged header      span.uppercase:has-text("Staged")
 *   changes header     span.uppercase:has-text("Changes")
 *   untracked header   span.uppercase:has-text("Untracked")
 *   stage-all header   button:has-text("stage all")
 *   unstage-all header button:has-text("unstage all")
 *
 * Commit area (bottom of status view)
 *   commit textarea    textarea[placeholder="commit message"]
 *   commit button      button:has-text("Commit Staged")
 *   push button        button:has-text("Push")
 *   branch display     span.font-mono.text-white\/40
 *
 * Stash panel (stash-selector.tsx)
 *   stash list         [role="list"][aria-label="Git stashes"]
 *   stash row          [role="listitem"]
 *   apply stash btn    button[aria-label^="Apply "]
 *   drop stash btn     button[aria-label^="Delete "]
 *   create stash btn   button[aria-label="Create new stash"]
 *   create dialog      [role="dialog"][aria-labelledby="create-stash-dialog-title"]
 *   stash msg textarea textarea#create-stash-message
 *   create confirm     button:has-text("Create") inside create dialog
 *   apply dialog       [role="dialog"][aria-labelledby="apply-stash-dialog-title"]
 *   drop dialog        [role="dialog"][aria-labelledby="drop-stash-dialog-title"]
 *   drop confirm       button:has-text("Delete") inside drop dialog
 *
 * Review panel (review-panel-section.tsx + review-assignment-dialog.tsx)
 *   panel heading      text=Peer Review
 *   assign reviewers   button:has-text("Assign Reviewers")
 *   assign dialog      [role="dialog"]:has-text("Assign")
 *   review card        div.p-3.rounded-md.border (keyed by review.id)
 *   status badge       div.inline-flex.items-center with text: Pending|In Review|Approved|Changes Requested
 * ──────────────────────────────────────────────────────────────────────────
 */
export class GitPanelPage {
  readonly page: Page;

  // ── Branch selector ────────────────────────────────────────────────────────
  readonly branchTrigger: Locator;
  readonly branchMenu: Locator;
  readonly newBranchInput: Locator;

  // ── View tabs ──────────────────────────────────────────────────────────────
  readonly statusTab: Locator;
  readonly stashTab: Locator;
  readonly logTab: Locator;
  readonly reviewTab: Locator;
  readonly refreshButton: Locator;

  // ── Commit area ────────────────────────────────────────────────────────────
  readonly commitTextarea: Locator;
  readonly commitButton: Locator;
  readonly pushButton: Locator;

  // ── Stash panel ────────────────────────────────────────────────────────────
  readonly stashList: Locator;
  readonly createStashButton: Locator;

  // ── Review panel ───────────────────────────────────────────────────────────
  readonly assignReviewersButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.branchTrigger = page.locator('[data-testid="branch-selector-trigger"]');
    this.branchMenu = page.locator('[role="menu"][aria-label="Available branches"]');
    this.newBranchInput = page.locator('input[placeholder="New branch name…"]');

    this.statusTab = page.locator('button[title="Changes"]');
    this.stashTab = page.locator('button[title="Stashes"]');
    this.logTab = page.locator('button[title="Log"]');
    this.reviewTab = page.locator('button[title="Review"]');
    this.refreshButton = page.locator('button[title="Refresh"]');

    this.commitTextarea = page.locator('textarea[placeholder="commit message"]');
    this.commitButton = page.locator('button:has-text("Commit Staged")');
    this.pushButton = page.locator('button:has-text("Push")');

    this.stashList = page.locator('[role="list"][aria-label="Git stashes"]');
    this.createStashButton = page.locator('button[aria-label="Create new stash"]');

    this.assignReviewersButton = page.locator('button:has-text("Assign Reviewers")');
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Navigate to the code editor and activate the Git panel.
   * The git view is a sidebar tab; this clicks "Source Control" to show it,
   * then waits for the branch selector to mount.
   */
  async openGitPanel() {
    await this.page.goto('/code');
    await this.page.waitForLoadState('networkidle');
    // The code editor starts on "files" view. Switch to git view.
    const sourceControlBtn = this.page.locator('button[title="Source Control"]');
    await expect(sourceControlBtn).toBeVisible({ timeout: 15000 });
    await sourceControlBtn.click();
    await expect(this.branchTrigger).toBeVisible({ timeout: 10000 });
  }

  // ── File operations ─────────────────────────────────────────────────────────

  /**
   * Click a file row to open its diff view.
   * @param filename The file name as shown in the panel (no directory prefix).
   */
  async selectFile(filename: string) {
    const fileRow = this._fileRow(filename);
    await fileRow.click();
  }

  /**
   * Stage a single file by hovering its row and clicking the + button.
   * Only works when the file has unstaged or untracked changes.
   */
  async stageFile(filename: string) {
    const fileRow = this._fileRow(filename);
    await fileRow.hover();
    await fileRow.locator('button[title="Stage file"]').click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Unstage a single file.
   * Only works when the file has staged changes.
   */
  async unstageFile(filename: string) {
    const fileRow = this._fileRow(filename);
    await fileRow.hover();
    await fileRow.locator('button[title="Unstage file"]').click();
    await this.page.waitForResponse('**/api/git');
  }

  /** Stage all files via the header button. */
  async stageAll() {
    await this.page.locator('button[title="Stage all"]').first().click();
    await this.page.waitForResponse('**/api/git');
  }

  /** Unstage all files via the header button. */
  async unstageAll() {
    await this.page.locator('button:has-text("unstage all")').first().click();
    await this.page.waitForResponse('**/api/git');
  }

  // ── Commit ──────────────────────────────────────────────────────────────────

  /**
   * Fill the commit message and click Commit Staged.
   * Files must already be staged or the button is disabled.
   */
  async commit(message: string) {
    await this.commitTextarea.fill(message);
    await this.commitButton.click();
    await this.page.waitForResponse('**/api/git');
  }

  /** Trigger a push to the remote origin. */
  async push() {
    await this.pushButton.click();
    await this.page.waitForResponse('**/api/git');
  }

  /** Refresh the git status panel. */
  async refresh() {
    await this.refreshButton.click();
    await this.page.waitForResponse('**/api/git');
  }

  // ── Branch management ───────────────────────────────────────────────────────

  /** Open the branch dropdown and wait for it to render. */
  async openBranchDropdown() {
    await this.branchTrigger.click();
    await expect(this.branchMenu).toBeVisible({ timeout: 5000 });
  }

  /**
   * Return all branch names currently visible in the dropdown.
   * Opens the dropdown if not already open.
   */
  async listBranches(): Promise<string[]> {
    await this.openBranchDropdown();
    const items = this.branchMenu.locator('[data-branch]');
    const count = await items.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = await items.nth(i).getAttribute('data-branch');
      if (name) names.push(name);
    }
    return names;
  }

  /**
   * Create a new branch from the current HEAD.
   * Types the name into the input and submits the form.
   */
  async createBranch(name: string) {
    await this.openBranchDropdown();
    await this.newBranchInput.fill(name);
    // The form submit button is inside the DropdownMenuGroup form
    await this.page.locator('button[type="submit"]:has-text("Create")').click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Switch to a branch by clicking its row in the dropdown.
   * Waits for the API response confirming the switch.
   */
  async switchBranch(name: string) {
    await this.openBranchDropdown();
    await this.branchMenu.locator(`[data-branch="${name}"]`).click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Delete a branch.
   * Clicks the trash icon, confirms in the dialog.
   * Pass `force: true` to click "Force Delete" for unmerged branches.
   */
  async deleteBranch(name: string, force = false) {
    await this.openBranchDropdown();
    await this.page.locator(`button[aria-label="Delete branch ${name}"]`).click();
    const dialog = this.page.locator('[role="dialog"][aria-label="Delete branch confirmation"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator(`button:has-text("${force ? 'Force Delete' : 'Delete'}")`).click();
    await this.page.waitForResponse('**/api/git');
  }

  /** Return the currently checked-out branch name from the trigger button. */
  async getCurrentBranch(): Promise<string> {
    const text = await this.branchTrigger.locator('span.font-mono').textContent();
    return text?.trim() ?? '';
  }

  // ── Stash management ────────────────────────────────────────────────────────

  /**
   * Create a stash from the current working directory changes.
   * Switches to the stash view, opens the dialog, fills an optional message.
   */
  async createStash(message?: string) {
    await this.stashTab.click();
    await expect(this.createStashButton).toBeVisible({ timeout: 5000 });
    await this.createStashButton.click();
    const dialog = this.page.locator(
      '[role="dialog"][aria-labelledby="create-stash-dialog-title"]'
    );
    await expect(dialog).toBeVisible({ timeout: 3000 });
    if (message) {
      await dialog.locator('textarea#create-stash-message').fill(message);
    }
    await dialog.locator('button:has-text("Create")').click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Apply a stash identified by its label (message text shown in the row).
   * Waits for the apply dialog to appear and then close.
   */
  async applyStash(stashLabel: string) {
    await this.stashTab.click();
    await expect(this.stashList).toBeVisible({ timeout: 5000 });
    await this.stashList
      .locator(`button[aria-label="Apply ${stashLabel}"]`)
      .click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Apply a stash by its numeric index (0 = newest).
   */
  async applyStashByIndex(index: number) {
    await this.stashTab.click();
    await expect(this.stashList).toBeVisible({ timeout: 5000 });
    const applyBtns = this.stashList.locator('button[aria-label^="Apply"]');
    await applyBtns.nth(index).click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Drop (delete) a stash, confirming in the confirmation dialog.
   */
  async dropStash(stashLabel: string) {
    await this.stashTab.click();
    await expect(this.stashList).toBeVisible({ timeout: 5000 });
    await this.stashList
      .locator(`button[aria-label="Delete ${stashLabel}"]`)
      .click();
    const dialog = this.page.locator(
      '[role="dialog"][aria-labelledby="drop-stash-dialog-title"]'
    );
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator('button:has-text("Delete")').click();
    await this.page.waitForResponse('**/api/git');
  }

  /**
   * Drop a stash by its numeric index (0 = newest), confirming deletion.
   */
  async dropStashByIndex(index: number) {
    await this.stashTab.click();
    await expect(this.stashList).toBeVisible({ timeout: 5000 });
    const dropBtns = this.stashList.locator('button[aria-label^="Delete"]');
    await dropBtns.nth(index).click();
    const dialog = this.page.locator(
      '[role="dialog"][aria-labelledby="drop-stash-dialog-title"]'
    );
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.locator('button:has-text("Delete")').click();
    await this.page.waitForResponse('**/api/git');
  }

  /** Return all stash rows as locators (newest first). */
  async getStashRows(): Promise<Locator[]> {
    await this.stashTab.click();
    await expect(this.stashList).toBeVisible({ timeout: 5000 });
    const rows = this.stashList.locator('[role="listitem"]');
    const count = await rows.count();
    return Array.from({ length: count }, (_, i) => rows.nth(i));
  }

  // ── Review / AI summary ─────────────────────────────────────────────────────

  /**
   * Switch to the review tab and return the visible text of the review section.
   * The ReviewPanelSection renders "Peer Review" + file selection info or
   * existing review cards. The text captures any AI summary shown there.
   */
  async readAISummary(): Promise<string> {
    await this.reviewTab.click();
    await this.page.waitForLoadState('domcontentloaded');
    // The review panel section has "Peer Review" as a heading
    const section = this.page
      .locator('text=Peer Review')
      .locator('xpath=ancestor::div[contains(@class,"space-y-3")]');
    return (await section.first().textContent()) ?? '';
  }

  /**
   * Click "Assign Reviewers" to open the assignment dialog.
   * Optionally fill in title and reviewer name before submitting.
   *
   * Note: ReviewAssignmentDialog uses Radix [role="dialog"]; selectors for
   * the reviewer-search input depend on the final form implementation in
   * web/components/git/review-assignment-dialog.tsx (not fully expanded in
   * this audit). Update these selectors after inspecting the rendered form.
   */
  async assignReviewer(opts: { reviewerName?: string; title?: string } = {}) {
    await this.reviewTab.click();
    await expect(this.assignReviewersButton).toBeVisible({ timeout: 5000 });
    await this.assignReviewersButton.click();

    const dialog = this.page.locator('[role="dialog"]').filter({ hasText: /assign/i });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    if (opts.title) {
      const titleInput = dialog
        .locator('input[placeholder*="title" i], input[name="title"]')
        .first();
      if (await titleInput.count() > 0) {
        await titleInput.fill(opts.title);
      }
    }

    if (opts.reviewerName) {
      const reviewerInput = dialog
        .locator('input[placeholder*="reviewer" i], input[placeholder*="search" i]')
        .first();
      if (await reviewerInput.count() > 0) {
        await reviewerInput.fill(opts.reviewerName);
        // Select matching result if a listbox appears
        const option = this.page
          .locator('[role="option"]')
          .filter({ hasText: opts.reviewerName });
        if (await option.count() > 0) {
          await option.first().click();
        }
      }
    }

    // Submit the form (label varies: "Submit" / "Assign" / "Create Review")
    await dialog
      .locator('button:has-text("Submit"), button:has-text("Assign"), button:has-text("Create")')
      .first()
      .click();
  }

  /**
   * Return the text content of the first review status badge visible
   * in the review panel.
   * Returns one of: "Pending", "In Review", "Approved", "Changes Requested".
   */
  async getReviewStatus(): Promise<string> {
    await this.reviewTab.click();
    const badge = this.page
      .locator('div.inline-flex.items-center')
      .filter({ hasText: /Pending|In Review|Approved|Changes Requested/ })
      .first();
    return (await badge.textContent())?.trim() ?? '';
  }

  // ── State helpers ───────────────────────────────────────────────────────────

  /** Return the count from the staged files section header, or 0 if absent. */
  async getStagedCount(): Promise<number> {
    await this.statusTab.click();
    const header = this.page
      .locator('span.uppercase')
      .filter({ hasText: 'Staged' })
      .first();
    if ((await header.count()) === 0) return 0;
    const countEl = header.locator('xpath=following-sibling::div//span[contains(@class,"font-mono")]');
    const text = await countEl.first().textContent();
    return parseInt(text ?? '0', 10);
  }

  /**
   * Wait for the "no changes" empty state to appear in the status view.
   * Useful after a commit to confirm the working tree is clean.
   */
  async waitForCleanState() {
    await this.statusTab.click();
    await expect(
      this.page.locator('text=no changes')
    ).toBeVisible({ timeout: 10000 });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Return the file row locator for a given filename.
   * Matches on the filename span inside the .group row.
   */
  private _fileRow(filename: string): Locator {
    // The FileRow renders: span.flex-1.font-mono containing filename + optional dir
    // We match on the span text; first() handles cases where dir matches too.
    return this.page
      .locator('.group.flex.items-center')
      .filter({
        has: this.page.locator(`span.font-mono:has-text("${filename}")`),
      })
      .first();
  }
}
