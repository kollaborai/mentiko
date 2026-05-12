import { Page, Locator } from '@playwright/test';

const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'test-password';

export class AppHelpers {
  constructor(private page: Page) {}

  async goto(path: string = '/') {
    await this.page.goto(path);
  }

  async login() {
    await this.page.goto('/');

    const onLoginPage = this.page.url().includes('/login');

    if (onLoginPage) {
      const passwordInput = this.page.locator('input[type="password"]');
      const hasPasswordInput = await passwordInput.count() > 0;

      if (hasPasswordInput) {
        await passwordInput.fill(TEST_PASSWORD);
        await this.page.click('button[type="submit"]');
        await this.page.waitForURL('/', { timeout: 10000 });
      }
    }
  }

  async isAuthEnabled(): Promise<boolean> {
    await this.page.goto('/chains');
    await this.page.waitForLoadState('networkidle');
    return this.page.url().includes('/login');
  }

  async waitForNetworkIdle() {
    await this.page.waitForLoadState('networkidle');
  }

  async getToastMessage() {
    return this.page.locator('[role="alert"], .toast, .notification').first().textContent();
  }

  async waitForToast() {
    await this.page.waitForSelector('[role="alert"], .toast, .notification', { timeout: 5000 });
  }

  getButton(text: string): Locator {
    return this.page.getByRole('button', { name: text });
  }

  getInput(label: string): Locator {
    return this.page.getByLabel(label);
  }

  async fillTextarea(text: string) {
    await this.page.locator('textarea').fill(text);
  }
}
