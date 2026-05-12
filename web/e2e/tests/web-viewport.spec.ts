import { test, expect } from "@playwright/test";

/**
 * Web viewport / browser page E2E tests.
 *
 * These tests verify the web proxy, viewport component, and /browser page.
 * Auth is handled by checking if we get redirected to /login -- if so, we
 * skip the test (auth-gated tests need proper credentials).
 */

async function gotoOrSkip(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  if (page.url().includes("/login")) {
    test.skip(true, "auth required -- set E2E_TEST_PASSWORD or disable auth");
  }
}

test.describe("web viewport / browser page", () => {
  test("browser page loads with empty state", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    await expect(page.getByPlaceholder("type a URL and hit enter...")).toBeVisible();
    await expect(page.getByText("enter a URL above to start browsing")).toBeVisible();
    await expect(page.getByRole("button", { name: "go" })).toBeVisible();
  });

  test("typing a URL and hitting go loads the viewport", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    const input = page.getByPlaceholder("type a URL and hit enter...");
    await input.fill("https://example.com");
    await page.getByRole("button", { name: "go" }).click();

    await test.step("viewport chrome renders", async () => {
      await expect(page.getByText("enter a URL above to start browsing")).not.toBeVisible();
      const iframe = page.locator("iframe");
      await expect(iframe).toBeVisible({ timeout: 10000 });
    });

    await test.step("proxy serves content in iframe", async () => {
      const iframe = page.locator("iframe");
      await expect(iframe).toHaveAttribute("src", /\/api\/system\/web-proxy\?url=/, { timeout: 10000 });

      const frame = iframe.contentFrame();
      await expect(frame.locator("h1")).toContainText("Example Domain", { timeout: 15000 });
    });
  });

  test("proxy API returns valid HTML for example.com", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    const response = await page.evaluate(async () => {
      const res = await fetch("/api/system/web-proxy?url=" + encodeURIComponent("https://example.com"));
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: await res.text(),
        frameOptions: res.headers.get("x-frame-options"),
        sourceUrl: res.headers.get("x-viewport-source-url"),
      };
    });

    await test.step("returns 200 with HTML", async () => {
      expect(response.status).toBe(200);
      expect(response.contentType).toContain("text/html");
    });

    await test.step("contains page content and interceptor", async () => {
      expect(response.body).toContain("Example Domain");
      expect(response.body).toContain("viewport-loaded");
      expect(response.body).toContain("viewport-navigate");
    });

    await test.step("strips framing restrictions", async () => {
      expect(response.frameOptions).toBe("SAMEORIGIN");
    });

    await test.step("tracks source URL", async () => {
      expect(response.sourceUrl).toContain("example.com");
    });
  });

  test("proxy blocks private/local addresses", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    const blocked = await page.evaluate(async () => {
      const urls = [
        "http://localhost:8080",
        "http://127.0.0.1",
        "http://192.168.1.1",
        "http://10.0.0.1",
      ];
      const results: { url: string; status: number }[] = [];
      for (const url of urls) {
        const res = await fetch("/api/system/web-proxy?url=" + encodeURIComponent(url));
        results.push({ url, status: res.status });
      }
      return results;
    });

    for (const result of blocked) {
      expect(result.status).toBe(400);
    }
  });

  test("proxy requires authentication", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const response = await page.goto(
      "http://localhost:3000/api/system/web-proxy?url=" + encodeURIComponent("https://example.com")
    );
    // should get 401 or redirect to login
    const status = response?.status();
    expect(status === 401 || status === 302 || status === 307).toBeTruthy();

    await context.close();
  });

  test("navigation works inside viewport", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    const input = page.getByPlaceholder("type a URL and hit enter...");
    await input.fill("https://example.com");
    await page.getByRole("button", { name: "go" }).click();

    const iframe = page.locator("iframe");
    await expect(iframe).toBeVisible({ timeout: 10000 });

    await test.step("iframe loads example.com", async () => {
      const frame = iframe.contentFrame();
      await expect(frame.locator("h1")).toContainText("Example Domain", { timeout: 15000 });
    });

    await test.step("clicking a link stays in iframe", async () => {
      const frame = iframe.contentFrame();
      const link = frame.locator("a[href]").first();
      if (await link.isVisible()) {
        await link.click();
        // give it time to navigate through proxy
        await page.waitForTimeout(3000);
        // iframe should still exist (parent didn't navigate away)
        await expect(iframe).toBeVisible();
      }
    });
  });

  test("address bar shows URL after loading", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    const input = page.getByPlaceholder("type a URL and hit enter...");
    await input.fill("https://example.com");
    await page.getByRole("button", { name: "go" }).click();

    const iframe = page.locator("iframe");
    await expect(iframe).toBeVisible({ timeout: 10000 });

    await test.step("viewport address bar shows URL", async () => {
      // the BrowserChrome renders the URL in a button inside the viewport
      await expect(page.getByText("example.com").first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("viewport session API CRUD works", async ({ page }) => {
    await gotoOrSkip(page, "/browser");

    const result = await page.evaluate(async () => {
      // create
      const createRes = await fetch("/api/system/viewport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", url: "https://example.com" }),
      });
      const createData = await createRes.json();
      const sessionId = createData.data?.id;
      if (!sessionId) return { error: "no session created", createData };

      // get
      const getRes = await fetch("/api/system/viewport?sessionId=" + sessionId);
      const getData = await getRes.json();

      // navigate
      const navRes = await fetch("/api/system/viewport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "navigate", sessionId, url: "https://google.com" }),
      });
      const navData = await navRes.json();

      // record event
      const eventRes = await fetch("/api/system/viewport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "event", sessionId, type: "click", data: { x: 100, y: 200 } }),
      });
      const eventData = await eventRes.json();

      // destroy
      const destroyRes = await fetch("/api/system/viewport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "destroy", sessionId }),
      });
      const destroyData = await destroyRes.json();

      return {
        created: createData.success,
        sessionId,
        retrieved: getData.success,
        retrievedUrl: getData.data?.url,
        navigated: navData.success,
        newUrl: navData.data?.url,
        historyLength: navData.data?.history?.length,
        eventRecorded: eventData.success,
        destroyed: destroyData.success,
      };
    });

    expect(result.created).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.retrieved).toBe(true);
    expect(result.retrievedUrl).toBe("https://example.com");
    expect(result.navigated).toBe(true);
    expect(result.newUrl).toBe("https://google.com");
    expect(result.historyLength).toBe(2);
    expect(result.eventRecorded).toBe(true);
    expect(result.destroyed).toBe(true);
  });
});
