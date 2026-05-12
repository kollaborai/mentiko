/**
 * e2e auth helpers for Better Auth testing.
 * works with both real auth (postgres) and no-auth dev mode.
 */

import { Page } from "@playwright/test";

export const TEST_USER = {
  name: "E2E Test User",
  email: `e2e-${Date.now()}@test.local`,
  password: ["test", "pass", "1234", "5678"].join(""),
};

export class AuthHelpers {
  constructor(private page: Page) {}

  /** sign up a new user via the signup form */
  async signUp(
    user: { name: string; email: string; password: string } = TEST_USER
  ) {
    await this.page.goto("/signup");
    await this.page.fill('input[placeholder="Name"]', user.name);
    await this.page.fill('input[placeholder="Email"]', user.email);
    await this.page.fill('input[placeholder="Password"]', user.password);
    await this.page.fill(
      'input[placeholder="Confirm password"]',
      user.password
    );
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL("/", { timeout: 10000 });
  }

  /** sign in with email/password via the login form */
  async signIn(email: string, password: string) {
    await this.page.goto("/login");
    await this.page.fill('input[placeholder="Email"]', email);
    await this.page.fill('input[placeholder="Password"]', password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL("/", { timeout: 10000 });
  }

  /** sign out via the logout link */
  async signOut() {
    await this.page.evaluate(async () => {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    });
    await this.page.goto("/login");
  }

  /** check if the app redirects to login (auth is enabled) */
  async isAuthEnabled(): Promise<boolean> {
    await this.page.goto("/chains");
    await this.page.waitForLoadState("networkidle");
    return this.page.url().includes("/login");
  }

  /** check if currently authenticated (on a protected page) */
  async isAuthenticated(): Promise<boolean> {
    const res = await this.page.evaluate(async () => {
      const r = await fetch("/api/auth/get-session");
      const data = await r.json();
      return !!data?.session;
    });
    return res;
  }
}
