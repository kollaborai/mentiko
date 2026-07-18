import { test, expect } from "@playwright/test";
import { AuthHelpers } from "../helpers/auth-helpers";
import { MIGRATION_CLAIM_BY_SHAPE_ID } from "../../lib/data-shapes/migration-claims";

/**
 * The claims banner is the collision-avoidance surface for the shared branch:
 * if it stops rendering, agents silently start stepping on each other's shapes.
 * Asserted against the real ledger page rather than a jsdom render so a routing,
 * auth, or client-boundary regression is caught too.
 */

const uniqueEmail = `e2e-claims-${Date.now()}@test.local`;
const password = ["test", "pass", "1234", "5678"].join("");

test.describe("data-shapes migration claims", () => {
  test.beforeEach(async ({ page }) => {
    const auth = new AuthHelpers(page);
    if (await auth.isAuthEnabled()) {
      await auth.signUp({ name: "E2E Claims", email: uniqueEmail, password });
    }
  });

  test("renders every active claim on the data-shapes ledger", async ({ page }) => {
    await page.goto("/docs/data-shapes");

    const banner = page.getByRole("region", { name: "Claimed shapes" });
    await expect(banner).toBeVisible();

    const entries = Object.entries(MIGRATION_CLAIM_BY_SHAPE_ID);
    expect(entries.length).toBeGreaterThan(0);

    for (const [shapeId, claim] of entries) {
      await expect(banner.getByText(shapeId, { exact: true })).toBeVisible();
      await expect(banner.getByText(claim.holder, { exact: true }).first()).toBeVisible();
      // The heartbeat is what another agent reads to decide whether the claim
      // is still held, so it has to reach the page, not just the module.
      await expect(banner.locator(`time[datetime="${claim.heartbeat}"]`).first()).toBeVisible();
    }
  });
});
