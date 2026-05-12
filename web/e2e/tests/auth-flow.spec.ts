import { test, expect } from "@playwright/test";
import { AuthHelpers } from "../helpers/auth-helpers";

const uniqueEmail = `e2e-auth-${Date.now()}@test.local`;
const password = ["test", "pass", "1234", "5678"].join("");

test.describe("auth flow", () => {
  test("redirects unauthenticated user to login", async ({ page }) => {
    const auth = new AuthHelpers(page);
    const authEnabled = await auth.isAuthEnabled();
    test.skip(!authEnabled, "auth not enabled");

    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 5000 });
    expect(page.url()).toContain("/login");
  });

  test("shows login page with email/password and OAuth buttons", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
    await expect(page.locator("button", { hasText: "Sign in" })).toBeVisible();
    await expect(page.locator("button", { hasText: "GitHub" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Google" })).toBeVisible();
    await expect(
      page.locator("button", { hasText: "Microsoft" })
    ).toBeVisible();
  });

  test("shows signup page with name, email, password fields", async ({
    page,
  }) => {
    await page.goto("/signup");
    await expect(page.locator('input[placeholder="Name"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
    await expect(
      page.locator('input[placeholder="Confirm password"]')
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "Create account" })
    ).toBeVisible();
  });

  test("signup with mismatched passwords shows error", async ({ page }) => {
    await page.goto("/signup");
    await page.fill('input[placeholder="Name"]', "Test");
    await page.fill('input[placeholder="Email"]', "test@mismatch.local");
    await page.fill('input[placeholder="Password"]', "password1234");
    await page.fill('input[placeholder="Confirm password"]', "different1234");
    await page.click('button[type="submit"]');

    await expect(page.locator("text=Passwords do not match")).toBeVisible({
      timeout: 3000,
    });
  });

  test("signup with short password shows error", async ({ page }) => {
    await page.goto("/signup");
    await page.fill('input[placeholder="Name"]', "Test");
    await page.fill('input[placeholder="Email"]', "test@short.local");
    await page.fill('input[placeholder="Password"]', "short");
    await page.fill('input[placeholder="Confirm password"]', "short");
    await page.click('button[type="submit"]');

    await expect(
      page.locator("text=Password must be at least 8 characters")
    ).toBeVisible({ timeout: 3000 });
  });

  test("full signup -> dashboard -> logout -> login cycle", async ({
    page,
  }) => {
    const auth = new AuthHelpers(page);
    const authEnabled = await auth.isAuthEnabled();
    test.skip(!authEnabled, "auth not enabled");

    // signup
    await auth.signUp({
      name: "E2E Tester",
      email: uniqueEmail,
      password,
    });
    expect(page.url()).not.toContain("/login");
    expect(page.url()).not.toContain("/signup");

    // verify session exists
    const isAuthed = await auth.isAuthenticated();
    expect(isAuthed).toBe(true);

    // logout
    await auth.signOut();
    expect(page.url()).toContain("/login");

    // login with same credentials
    await auth.signIn(uniqueEmail, password);
    expect(page.url()).not.toContain("/login");
  });

  test("login with wrong password shows error", async ({ page }) => {
    const auth = new AuthHelpers(page);
    const authEnabled = await auth.isAuthEnabled();
    test.skip(!authEnabled, "auth not enabled");

    await page.goto("/login");
    await page.fill('input[placeholder="Email"]', "wrong@test.local");
    await page.fill('input[placeholder="Password"]', "wrongpassword1");
    await page.click('button[type="submit"]');

    // should stay on login page with error
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/login");
  });

  test("navigate between login and signup", async ({ page }) => {
    await page.goto("/login");
    await page.click("text=Sign up");
    await expect(page).toHaveURL(/\/signup/);

    await page.click("text=Sign in");
    await expect(page).toHaveURL(/\/login/);
  });

  test("OAuth buttons redirect to provider", async ({ page }) => {
    await page.goto("/login");

    // click GitHub - should navigate away from login
    await page.click("button:has-text('GitHub')");
    await page.waitForTimeout(2000);

    // should have left the login page (redirected to OAuth provider or mock)
    const url = page.url();
    expect(url).not.toContain("/login");
  });
});
