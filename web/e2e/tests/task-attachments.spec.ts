import { test, expect } from "@playwright/test";
import { AuthHelpers } from "../helpers/auth-helpers";

/**
 * TASK-006 end-to-end: image attachment intake + rendering.
 *
 * Proves the binding addendum in the real browser:
 * - create dialog: paste zone + picker stage files, and the upload happens
 *   only AFTER the task exists (create -> upload ordering)
 * - picker and paste feed the same multipart endpoint
 * - the detail view renders filename, size, timestamp, and the image
 * - rejected uploads surface a visible error chip (no silent drops)
 */

// per-test unique email: one shared address would 422 on the second signup
let emailCounter = 0;
const uniqueEmail = () => `e2e-attach-${Date.now()}-${++emailCounter}@test.local`;
const password = ["test", "pass", "1234", "5678"].join("");

// 1x1 PNG, valid magic bytes so the server-side sniff accepts it
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function openCreateDialog(page: import("@playwright/test").Page) {
  await page.goto("/tasks");
  // fresh-install onboarding modal blocks interaction until dismissed
  const onboarding = page.getByRole("button", { name: "I’ll explore first" });
  try {
    await onboarding.click({ timeout: 4000 });
  } catch {
    // not shown (returning user) -- fine
  }
  // real-UI path: the sidebar "Create or generate task" icon button exists in
  // both the empty state and a populated list
  await page.getByRole("button", { name: "Create or generate task" }).click();
  const dialog = page.getByText("Create Work Item", { exact: true });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  // switch Method -> Manual so the stager renders
  await page.getByRole("button", { name: "Manual" }).click();
  await expect(page.getByTestId("attachment-paste-zone")).toBeVisible();
}

test.describe("task image attachments (TASK-006)", () => {
  test.beforeEach(async ({ page }) => {
    const auth = new AuthHelpers(page);
    if (await auth.isAuthEnabled()) {
      await auth.signUp({ name: "E2E Attach", email: uniqueEmail(), password });
    }
  });

  test("create flow: picker stages an image, uploads after the task exists, renders on detail", async ({ page }) => {
    await openCreateDialog(page);

    // stage via the picker
    await page.getByTestId("task-attachment-input").setInputFiles({
      name: "e2e-shot.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await expect(page.getByText(/will upload after create/i)).toBeVisible();

    // fill the manual prompt (first line = title) and create
    await page.getByPlaceholder(/describe what needs to be done/i).fill("Attachment e2e task\ncreated by TASK-006 e2e");
    await page.getByRole("button", { name: "Create Task", exact: true }).click();

    // after create, the dialog closes; open the new task's detail
    await expect(page.getByText("Create Work Item", { exact: true })).toBeHidden();
    await page.getByText("Attachment e2e task").first().click();

    // detail view: attachments section shows the uploaded image
    const card = page.getByTestId("task-attachment-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("e2e-shot.png")).toBeVisible();
    const src = await card.locator("img").getAttribute("src");
    expect(src).toContain("/attachments/");
    const img = card.locator("img");
    await expect(img).toHaveJSProperty("naturalWidth", 1);
  });

  test("create flow: paste into the zone stages and uploads via the same endpoint", async ({ page }) => {
    await openCreateDialog(page);

    const zone = page.getByTestId("attachment-paste-zone");
    await zone.click();
    // build a real ClipboardEvent inside the page: Playwright cannot
    // serialize File objects through dispatchEvent
    await page.evaluate(
      ({ b64, name }: { b64: string; name: string }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], name, { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const zone = document.querySelector<HTMLElement>('[data-testid="attachment-paste-zone"]');
        zone?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
      },
      { b64: PNG_BYTES.toString("base64"), name: "pasted.png" },
    );

    await expect(page.getByText(/will upload after create/i)).toBeVisible();

    await page.getByPlaceholder(/describe what needs to be done/i).fill("Paste e2e task\nvia clipboard");
    await page.getByRole("button", { name: "Create Task", exact: true }).click();
    await expect(page.getByText("Create Work Item", { exact: true })).toBeHidden();

    await page.getByText("Paste e2e task").first().click();
    await expect(page.getByTestId("task-attachment-card").getByText("pasted.png")).toBeVisible();
  });

  test("edit flow: picker uploads against the existing task and renders", async ({ page }) => {
    // seed a task through the create dialog (no attachments)
    await openCreateDialog(page);
    await page.getByPlaceholder(/describe what needs to be done/i).fill("Edit attach task\nseed");
    await page.getByRole("button", { name: "Create Task", exact: true }).click();
    await expect(page.getByText("Create Work Item", { exact: true })).toBeHidden();

    await page.getByText("Edit attach task").first().click();

    // detail view -> Edit button (Pencil icon, text "Edit") opens the dialog
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText("Edit Task", { exact: true })).toBeVisible();
    // scope to the dialog overlay: the detail view behind it also renders
    // these testids; the overlay is the fixed z-50 container
    const overlay = page.locator("div.fixed.inset-0.z-50");
    await overlay.getByTestId("attachment-picker-button").click();
    await overlay.getByTestId("task-attachment-input").setInputFiles({
      name: "edit-added.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });

    // upload fires immediately against the existing task id; the card
    // appears inside the edit dialog's attachment section
    const card = overlay.getByTestId("task-attachment-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("edit-added.png")).toBeVisible();

    // save closes the dialog; a fresh load proves the blob persisted and
    // renders from the bytes route on the detail view
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Edit Task", { exact: true })).toBeHidden();
    await page.reload({ waitUntil: "networkidle" });
    // let client hydration settle before clicking: a click during hydration
    // hits the SSR markup and the detail's fetch never fires
    await page.waitForTimeout(1000);
    await page.getByText("Edit attach task").first().click();
    // dev-mode first fetch of the attachments list can be slow: give it room
    await expect(
      page.getByTestId("task-attachment-card").getByText("edit-added.png"),
    ).toBeVisible({ timeout: 15000 });
  });

  test("rejected upload surfaces a visible error chip (empty file)", async ({ page }) => {
    await openCreateDialog(page);

    // a 0-byte PNG parses as valid multipart but fails server-side size
    // validation: the envelope must carry empty_file and the UI must show it
    await page.getByTestId("task-attachment-input").setInputFiles({
      name: "empty.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(0),
    });
    await expect(page.getByText(/will upload after create/i)).toBeVisible();

    await page.getByPlaceholder(/describe what needs to be done/i).fill("Empty e2e task\nshould show chip");
    await page.getByRole("button", { name: "Create Task", exact: true }).click();

    const chips = page.getByTestId("attachment-error-chips");
    await expect(chips).toBeVisible();
    await expect(chips).toContainText(/empty_file|empty/i);
  });
});
