import { test, expect, type Page } from "@playwright/test";

const FORBIDDEN_DISABLED_RUNTIME = [
  "/api/kollabor/setup/mentiko",
  "/api/kollabor/token",
  "/api/system/ai-gateway",
  "/api/system/codex-token",
  "/api/mentiko-mcp/stream",
  "/api/mentiko-mcp/current-page",
  "/api/kollabor/engine/health",
  "/api/kollabor/engine/sessions",
];

function isForbiddenDisabledRuntimeRequest(request: import("@playwright/test").Request): boolean {
  const pathname = new URL(request.url()).pathname;
  const isBoundedShutdownCancellation = request.method() === "POST" &&
    /^\/api\/kollabor\/engine\/sessions\/[^/]+\/cancel$/.test(pathname);
  return !isBoundedShutdownCancellation &&
    FORBIDDEN_DISABLED_RUNTIME.some((path) => pathname.startsWith(path));
}

async function openAuthenticatedSettings(page: Page) {
  await page.goto("/settings/mentiko-agent", { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    const email = process.env.E2E_BAR_EMAIL;
    const password = process.env.E2E_BAR_PASSWORD;
    test.skip(!email || !password, "set E2E_BAR_EMAIL and E2E_BAR_PASSWORD for authenticated bar E2E");
    await page.fill('input[placeholder="Email"]', email!);
    await page.fill('input[placeholder="Password"]', password!);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
    await page.goto("/settings/mentiko-agent", { waitUntil: "domcontentloaded" });
  }
  await expect(page).toHaveURL(/\/settings\/mentiko-agent/);
  await expect(page.getByRole("switch", { name: "Enable floating bar" })).toBeVisible();
}

async function openAuthenticatedSettingsAt(page: Page, baseUrl: string) {
  const settingsUrl = new URL("/settings/mentiko-agent", baseUrl).href;
  await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    const email = process.env.E2E_BAR_EMAIL;
    const password = process.env.E2E_BAR_PASSWORD;
    test.skip(!email || !password, "set E2E_BAR_EMAIL and E2E_BAR_PASSWORD for authenticated deployment-off E2E");
    await page.fill('input[placeholder="Email"]', email!);
    await page.fill('input[placeholder="Password"]', password!);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
  }
  await expect(page).toHaveURL(/\/settings\/mentiko-agent/);
  await expect(page.getByRole("switch", { name: "Enable floating bar" })).toBeVisible();
}

async function enabledKey(page: Page): Promise<string> {
  return `mentiko-kollabor-enabled:${await activeAuthenticatedScope(page)}`;
}

async function scopedYoloPreferenceSnapshot(page: Page): Promise<Array<{ key: string; value: string | null }>> {
  return page.evaluate(async () => {
    const scopeResponse = await fetch("/api/system/storage-scope", { cache: "no-store" });
    if (!scopeResponse.ok) throw new Error(`storage scope lookup failed: ${scopeResponse.status}`);
    const scopeBody = await scopeResponse.json();
    const installScope = scopeBody?.data?.storageScope;

    const sessionResponse = await fetch("/api/auth/get-session", { cache: "no-store" });
    if (!sessionResponse.ok) throw new Error(`session lookup failed: ${sessionResponse.status}`);
    const sessionBody = await sessionResponse.json();
    const userId = sessionBody?.user?.id ?? sessionBody?.data?.user?.id;
    if (typeof installScope !== "string" || typeof userId !== "string" || !userId) {
      throw new Error("could not resolve the active authenticated preference scope");
    }

    const scope = `${installScope}:user:${userId}`;
    return [
      `mentiko-kollabor-yolo:${scope}`,
      `mentiko-kollabor-yolo-seen:${scope}`,
    ].map((key) => ({ key, value: localStorage.getItem(key) }));
  });
}

async function restoreScopedPreferences(page: Page, preferences: Array<{ key: string; value: string | null }>) {
  await page.evaluate((entries) => {
    for (const { key, value } of entries) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }, preferences);
}

async function blockScopedPreferenceWrite(page: Page, key: string) {
  await page.evaluate((blockedKey) => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "__floatingBarOriginalStorageSetItem", {
      configurable: true,
      value: original,
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      writable: true,
      value: function (this: Storage, name: string, value: string) {
        if (name === blockedKey) throw new DOMException("fixture storage write failure", "QuotaExceededError");
        return Reflect.apply(original, this, [name, value]);
      },
    });
  }, key);
}

async function restoreStorageWriteMethod(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as { __floatingBarOriginalStorageSetItem?: Storage["setItem"] };
    const original = state.__floatingBarOriginalStorageSetItem;
    if (original) {
      Object.defineProperty(Storage.prototype, "setItem", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
    delete state.__floatingBarOriginalStorageSetItem;
  });
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type FixtureCancelMode = "receipt-only" | "failure" | "held-receipt-only";

async function installMockBarRuntime(
  page: Page,
  cancelMode: FixtureCancelMode = "receipt-only",
) {
  const counts = { setup: 0, health: 0, creates: 0, streams: 0, messages: 0, cancels: 0 };
  const sessionIds: string[] = [];
  const messageStarted = deferred();
  const releaseMessage = deferred();
  const messageSettled = deferred();
  const cancelStarted = deferred();
  const releaseCancel = deferred();

  await page.route("**/api/system/ai-gateway", (route) => route.fulfill({
    json: { success: true, data: { gatewayEnabled: true, mentikoProfileActive: true } },
  }));
  await page.route("**/api/kollabor/setup/mentiko", async (route) => {
    counts.setup += 1;
    await route.fulfill({ json: { ok: true, synced: false, agentFingerprint: "e2e-fixture" } });
  });
  await page.route("**/api/kollabor/token", (route) => route.fulfill({
    json: { token: "route-intercepted-e2e-token", baseUrl: "/api/kollabor/engine" },
  }));
  await page.route("**/api/mentiko-mcp/stream**", async (route) => {
    counts.streams += 1;
    // 204 closes EventSource without starting its automatic reconnect loop.
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/kollabor/engine/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/kollabor\/engine/, "");
    if (request.method() === "GET" && path === "/health") {
      counts.health += 1;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (request.method() === "POST" && path === "/sessions") {
      counts.creates += 1;
      const body = request.postDataJSON() as { session_id?: string };
      const sessionId = body.session_id || `sess_floating_bar_e2e_${counts.creates}`;
      sessionIds.push(sessionId);
      await route.fulfill({
        json: {
          session_id: sessionId,
          profile: "mentiko",
          agent: "mentiko",
          mcp_servers: ["mentiko"],
          active: true,
          session_token: `route-intercepted-token-${counts.creates}`,
        },
      });
      return;
    }
    if (request.method() === "POST" && /\/sessions\/[^/]+\/message$/.test(path)) {
      counts.messages += 1;
      messageStarted.resolve();
      await releaseMessage.promise;
      try {
        // Only cleanup releases this request. The transition tests never assert
        // a successful turn or cancellation from this fixture stream.
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: "data: {\"type\":\"turn_complete\"}\n\n",
        });
      } catch {
        // The browser should abort this request when the bar is disabled.
      } finally {
        messageSettled.resolve();
      }
      return;
    }
    if (request.method() === "POST" && /\/sessions\/[^/]+\/cancel$/.test(path)) {
      counts.cancels += 1;
      cancelStarted.resolve();
      if (cancelMode === "held-receipt-only") await releaseCancel.promise;
      if (cancelMode === "failure") {
        await route.fulfill({ status: 503, json: { error: "fixture cancellation unavailable" } });
      } else {
        // Intentionally receipt-only: no turn id, terminal/tool proof, or fence.
        await route.fulfill({ json: { ok: true } });
      }
      return;
    }
    if (request.method() === "GET" && /\/sessions\/[^/]+$/.test(path)) {
      const sessionId = path.split("/").at(-1);
      await route.fulfill({
        json: {
          session_id: sessionId,
          profile: "mentiko",
          mcp_servers: ["mentiko"],
          active: true,
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return { counts, sessionIds, messageStarted, releaseMessage, messageSettled, cancelStarted, releaseCancel };
}

async function activeAuthenticatedScope(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const scopeResponse = await fetch("/api/system/storage-scope", { cache: "no-store" });
    if (!scopeResponse.ok) throw new Error(`storage scope lookup failed: ${scopeResponse.status}`);
    const scopeBody = await scopeResponse.json();
    const installScope = scopeBody?.data?.storageScope;

    const sessionResponse = await fetch("/api/auth/get-session", { cache: "no-store" });
    if (!sessionResponse.ok) throw new Error(`session lookup failed: ${sessionResponse.status}`);
    const sessionBody = await sessionResponse.json();
    const userId = sessionBody?.user?.id ?? sessionBody?.data?.user?.id;
    if (typeof installScope !== "string" || typeof userId !== "string" || !userId) {
      throw new Error("could not resolve the active authenticated preference scope");
    }
    return `${installScope}:user:${userId}`;
  });
}

async function scopedWidthAndAppearanceSnapshot(page: Page): Promise<Array<{ key: string; value: string | null }>> {
  const scope = await activeAuthenticatedScope(page);
  const keys = [
    `mentiko-kollabor-width:${scope}`,
    `mentiko-kollabor-appearance:${scope}`,
  ];
  return page.evaluate((scopedKeys) => scopedKeys.map((key) => ({ key, value: localStorage.getItem(key) })), keys);
}

async function startHeldTurn(
  page: Page,
  runtime: Awaited<ReturnType<typeof installMockBarRuntime>>,
  message = "fixture turn to exercise local shutdown",
) {
  const messagesBeforeSend = runtime.counts.messages;
  await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(1);
  const input = page.getByPlaceholder("message");
  await expect(input).toBeVisible();
  await input.fill(message);
  await input.press("Enter");
  await expect.poll(() => runtime.counts.messages).toBe(messagesBeforeSend + 1);
}

async function signInAsSecondTestUser(page: Page) {
  const email = process.env.E2E_BAR_SCOPE_B_EMAIL;
  const password = process.env.E2E_BAR_SCOPE_B_PASSWORD;
  test.skip(!email || !password, "set E2E_BAR_SCOPE_B_EMAIL and E2E_BAR_SCOPE_B_PASSWORD for A-to-B scope E2E");

  await page.locator('button[title="Settings"]').last().hover();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 15_000 });
  await page.goto("/login?redirect=%2Fsettings%2Fmentiko-agent", { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="Email"]', email!);
  await page.fill('input[placeholder="Password"]', password!);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname === "/settings/mentiko-agent", { timeout: 15_000 });
}

test("unauthenticated settings navigation follows the login redirect", async ({ page }) => {
  await page.goto("/settings/mentiko-agent", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings%2Fmentiko-agent/);
});

test("settings route marks Mentiko Agent as the active sidebar item", async ({ page }) => {
  await openAuthenticatedSettings(page);
  const sidebar = page.getByTestId("settings-sidebar-nav");
  const activeItem = sidebar.getByRole("button", { name: "Mentiko Agent", exact: true });

  await expect(activeItem).toHaveAttribute("aria-current", "page");
  await expect(activeItem).toHaveClass(/bg-foreground\/10/);
});

test("documents cross-tab preferences as refresh-consistent and shared-session cancellation", async () => {
  // Avoid a static Node import: Playwright's TS loader otherwise emits a CJS
  // require in this ESM test context (`ReferenceError: require is not defined`).
  const fs = process.getBuiltinModule("fs") as Pick<typeof import("node:fs"), "readFileSync">;
  const guide = fs.readFileSync(`${process.cwd()}/docs/user-guide.md`, "utf8");
  expect(guide).toMatch(/Separate browser tabs are intentionally\s+refresh-consistent rather than live-synchronized/);
  expect(guide).toMatch(/Cancellation may still affect another tab sharing the same\s+engine session/);
});

test("acceptance ledger maps every spec criterion to named evidence and a result", () => {
  const fs = process.getBuiltinModule("fs") as typeof import("node:fs");
  const path = process.getBuiltinModule("path") as typeof import("node:path");
  const projectRoot = `${process.cwd()}/..`;
  const spec = fs.readFileSync(`${projectRoot}/docs/FLOATING_BAR_ENABLE_DISABLE_SPEC.md`, "utf8");
  const ledger = fs.readFileSync(`${projectRoot}/docs/FLOATING_BAR_ENABLE_DISABLE_ACCEPTANCE.md`, "utf8");
  const acceptanceSection = spec.split("## Acceptance criteria")[1]?.split("## Test plan")[0];
  expect(acceptanceSection).toBeDefined();

  const specCriteria = acceptanceSection!.split("\n").filter((line) => line.startsWith("- "));
  const ledgerRows = ledger.split("\n").filter((line) => /^\| AC-\d{2} \|/.test(line));
  expect(specCriteria).toHaveLength(27);
  expect(ledgerRows).toHaveLength(specCriteria.length + 2);
  expect(ledgerRows.some((line) => /^\| AC-25 \|/.test(line))).toBe(true);
  expect(ledgerRows.some((line) => /^\| AC-29 \|/.test(line))).toBe(true);

  const ids = ledgerRows.map((line) => line.split("|")[1]?.trim() ?? "");
  expect(new Set(ids).size).toBe(ledgerRows.length);
  expect([...ids].sort()).toEqual(
    Array.from({ length: specCriteria.length + 2 }, (_, index) => `AC-${String(index + 1).padStart(2, "0")}`),
  );

  const testSources: string[] = [];
  const collectTestSources = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const sourcePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectTestSources(sourcePath);
      } else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        testSources.push(fs.readFileSync(sourcePath, "utf8"));
      }
    }
  };
  for (const directory of ["app", "components", "lib", "e2e", "tests"]) {
    const sourcePath = path.join(process.cwd(), directory);
    if (fs.existsSync(sourcePath)) collectTestSources(sourcePath);
  }

  for (const row of ledgerRows) {
    const columns = row.split("|").map((column) => column.trim());
    expect(columns, `malformed acceptance row: ${row}`).toHaveLength(6);
    const namedEvidence = [...columns[3].matchAll(/`([^`]+)`/g)]
      .map((match) => match[1])
      .filter((name) => /\s/.test(name) && !name.includes("/"));
    expect(namedEvidence, `missing named test/check in: ${columns[1]}`).not.toHaveLength(0);
    for (const name of namedEvidence) {
      expect(
        testSources.some((source) => source.includes(name)),
        `named evidence does not appear in a local test source: ${columns[1]} -> ${name}`,
      ).toBe(true);
    }
    expect(columns[4], `missing explicit result in: ${columns[1]}`).toMatch(
      /^(PASS|PARTIAL|BLOCKED|AUTH-BLOCKED|AUTH-SKIPPED|UNVERIFIED)(?:\b|:)/,
    );
  }
});

test.describe("floating bar enable/disable", () => {
  test("profile API failure is separate from authenticated preference-scope hydration", async ({ page }) => {
    test.skip(
      !process.env.E2E_BAR_EMAIL || !process.env.E2E_BAR_PASSWORD,
      "set E2E_BAR_EMAIL and E2E_BAR_PASSWORD for authenticated bar E2E",
    );
    await installMockBarRuntime(page);
    await page.route("**/api/kollabor/engine/profiles", (route) => route.fulfill({
      status: 503,
      json: { error: "engine unavailable" },
    }));
    const scopeResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/system/storage-scope",
    );

    await openAuthenticatedSettings(page);

    expect((await scopeResponse).status()).toBe(200);
    await expect(page.getByText("Failed to load profiles: 503")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Enable floating bar" })).toBeEnabled();
    await expect(page.getByRole("switch", { name: "YOLO mode" })).toBeEnabled();
    await expect(page.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toBeEnabled();
  });

  test("new scope starts with YOLO enabled and preserves opt-out across reload", async ({ page }) => {
    const runtime = await installMockBarRuntime(page);
    await openAuthenticatedSettings(page);
    const originalScopedValues = await scopedYoloPreferenceSnapshot(page);
    const [yoloKey, yoloSeenKey] = originalScopedValues;

    try {
      await page.evaluate((entries) => {
        for (const { key } of entries) localStorage.removeItem(key);
      }, originalScopedValues);
      await page.reload({ waitUntil: "domcontentloaded" });

      const yoloToggle = page.getByRole("switch", { name: "YOLO mode" });
      await expect(yoloToggle).toHaveAttribute("aria-checked", "true");

      await startHeldTurn(page, runtime, "first send in a new preference scope");
      await expect(page.getByText("How should I handle tools?")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Ask me first" })).toHaveCount(0);
      runtime.releaseMessage.resolve();

      await yoloToggle.click();
      await expect(yoloToggle).toHaveAttribute("aria-checked", "false");
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), yoloKey.key)).toBe("0");
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), yoloSeenKey.key)).toBe("1");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("switch", { name: "YOLO mode" })).toHaveAttribute("aria-checked", "false");
    } finally {
      runtime.releaseMessage.resolve();
      // Only restore this Playwright context's two keys for the active authenticated scope.
      await restoreScopedPreferences(page, originalScopedValues);
    }
  });

  test("rapid off/on stays blocked while fixture cancellation is unresolved", async ({ page }) => {
    const runtime = await installMockBarRuntime(page, "held-receipt-only");
    await openAuthenticatedSettings(page);
    const scope = await activeAuthenticatedScope(page);
    const enabledKey = `mentiko-kollabor-enabled:${scope}`;
    const originalEnabled = await page.evaluate((key) => localStorage.getItem(key), enabledKey);

    try {
      await startHeldTurn(page, runtime);
      const toggle = page.getByRole("switch", { name: "Enable floating bar" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect.poll(() => runtime.counts.cancels).toBe(1);

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      expect(runtime.counts.creates).toBe(1);
      expect(runtime.counts.streams).toBe(1);

      runtime.releaseCancel.resolve();
      await expect(page.getByRole("alert")).toContainText("Bar hidden. Could not confirm the active turn stopped.");
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      expect(runtime.counts.creates).toBe(1);
    } finally {
      runtime.releaseCancel.resolve();
      runtime.releaseMessage.resolve();
      await restoreScopedPreferences(page, [{ key: enabledKey, value: originalEnabled }]);
    }
  });

  test("receipt-only cancellation keeps shutdown recovery blocked", async ({ page }) => {
    const runtime = await installMockBarRuntime(page, "receipt-only");
    await openAuthenticatedSettings(page);
    const scope = await activeAuthenticatedScope(page);
    const enabledKey = `mentiko-kollabor-enabled:${scope}`;
    const shutdownKey = `mentiko-kollabor-pending-shutdown:${scope}`;
    const originalEnabled = await page.evaluate((key) => localStorage.getItem(key), enabledKey);

    try {
      await startHeldTurn(page, runtime);
      await page.getByRole("switch", { name: "Enable floating bar" }).click();
      await expect(page.getByRole("alert")).toContainText("Bar hidden. Could not confirm the active turn stopped.");
      expect(runtime.counts.cancels).toBe(1);
      expect(await page.evaluate((key) => localStorage.getItem(key), shutdownKey)).not.toBeNull();
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
    } finally {
      runtime.releaseMessage.resolve();
      await restoreScopedPreferences(page, [{ key: enabledKey, value: originalEnabled }]);
    }
  });

  test("cancellation HTTP failure keeps shutdown recovery blocked", async ({ page }) => {
    const runtime = await installMockBarRuntime(page, "failure");
    await openAuthenticatedSettings(page);
    const scope = await activeAuthenticatedScope(page);
    const enabledKey = `mentiko-kollabor-enabled:${scope}`;
    const shutdownKey = `mentiko-kollabor-pending-shutdown:${scope}`;
    const originalEnabled = await page.evaluate((key) => localStorage.getItem(key), enabledKey);

    try {
      await startHeldTurn(page, runtime);
      await page.getByRole("switch", { name: "Enable floating bar" }).click();
      await expect(page.getByRole("alert")).toContainText("Bar hidden. Could not confirm the active turn stopped.");
      expect(runtime.counts.cancels).toBe(1);
      expect(await page.evaluate((key) => localStorage.getItem(key), shutdownKey)).not.toBeNull();
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
    } finally {
      runtime.releaseMessage.resolve();
      await restoreScopedPreferences(page, [{ key: enabledKey, value: originalEnabled }]);
    }
  });

  test("A-to-B account change isolates preferences and engine session keys", async ({ page }) => {
    test.skip(
      !process.env.E2E_BAR_SCOPE_B_EMAIL || !process.env.E2E_BAR_SCOPE_B_PASSWORD,
      "set E2E_BAR_SCOPE_B_EMAIL and E2E_BAR_SCOPE_B_PASSWORD for the second isolated test identity",
    );
    const runtime = await installMockBarRuntime(page, "receipt-only");
    await openAuthenticatedSettings(page);
    const scopeA = await activeAuthenticatedScope(page);
    const originalA = await scopedYoloPreferenceSnapshot(page);
    const shutdownKeyA = `mentiko-kollabor-pending-shutdown:${scopeA}`;
    const originalShutdownA = await page.evaluate((key) => localStorage.getItem(key), shutdownKeyA);
    originalA.push({ key: shutdownKeyA, value: originalShutdownA });
    expect(originalShutdownA).toBeNull();
    const yolo = page.getByRole("switch", { name: "YOLO mode" });

    try {
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(1);
      await expect.poll(() => runtime.sessionIds.length).toBeGreaterThan(0);
      const sessionA = await page.evaluate((scope) => localStorage.getItem(`mentiko-kollabor-session-id-v2:${scope}`), scopeA);
      expect(sessionA).toBe(runtime.sessionIds[0]);

      if (await yolo.getAttribute("aria-checked") === "true") await yolo.click();
      await expect(yolo).toHaveAttribute("aria-checked", "false");

      const heldAMessage = "held A turn during account scope change";
      await startHeldTurn(page, runtime, heldAMessage);
      const abortedATurn = page.waitForEvent("requestfailed", (request) =>
        new URL(request.url()).pathname.endsWith("/message"),
      );
      await signInAsSecondTestUser(page);
      const failedRequest = await abortedATurn;
      expect(failedRequest.failure()?.errorText ?? "").toMatch(/ERR_ABORTED|abort/i);
      await expect.poll(() => runtime.counts.cancels).toBe(1);

      const scopeB = await activeAuthenticatedScope(page);
      test.skip(scopeB === scopeA, "the configured A and B E2E accounts resolve to the same preference scope");
      const originalB = await scopedYoloPreferenceSnapshot(page);
      const shutdownKeyB = `mentiko-kollabor-pending-shutdown:${scopeB}`;
      const originalShutdownB = await page.evaluate((key) => localStorage.getItem(key), shutdownKeyB);
      originalB.push({ key: shutdownKeyB, value: originalShutdownB });

      try {
        const yoloB = page.getByRole("switch", { name: "YOLO mode" });
        await expect(yoloB).toHaveAttribute("aria-checked", "true");
        expect(await page.evaluate((scope) => localStorage.getItem(`mentiko-kollabor-yolo:${scope}`), scopeB)).toBeNull();
        expect(await page.evaluate((scope) => localStorage.getItem(`mentiko-kollabor-yolo-seen:${scope}`), scopeB)).toBeNull();
        expect(await page.evaluate((scope) => localStorage.getItem(`mentiko-kollabor-yolo:${scope}`), scopeA)).toBe("0");
        const pendingA = await page.evaluate((key) => localStorage.getItem(key), shutdownKeyA);
        expect(pendingA).not.toBeNull();
        expect(JSON.parse(pendingA!)).toMatchObject({ scope: scopeA, sessionId: sessionA });
        expect(await page.evaluate((key) => localStorage.getItem(key), shutdownKeyB)).toBe(originalShutdownB);

        await expect.poll(() => runtime.sessionIds.length).toBeGreaterThan(1);
        const sessionB = await page.evaluate((scope) => localStorage.getItem(`mentiko-kollabor-session-id-v2:${scope}`), scopeB);
        expect(sessionB).not.toBeNull();
        expect(sessionB).not.toBe(sessionA);

        runtime.releaseMessage.resolve();
        await runtime.messageSettled.promise;
        await expect(page.locator("[data-floating-kollabor-bar]").getByText(heldAMessage, { exact: true })).toHaveCount(0);

        await startHeldTurn(page, runtime, "first send after changing preference scope");
        await expect(page.getByText("How should I handle tools?")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Ask me first" })).toHaveCount(0);
        await expect(page.locator("[data-floating-kollabor-bar]").getByText(heldAMessage, { exact: true })).toHaveCount(0);
      } finally {
        await restoreScopedPreferences(page, originalB);
      }
    } finally {
      runtime.releaseMessage.resolve();
      await restoreScopedPreferences(page, originalA);
    }
  });

  test("authenticated settings route disables runtime across reload without forbidden work", async ({ page }) => {
    const runtime = await installMockBarRuntime(page);
    await openAuthenticatedSettings(page);
    const toggle = page.getByRole("switch", { name: "Enable floating bar" });
    const key = await enabledKey(page);
    const originalEnabled = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
    const wasEnabled = await toggle.getAttribute("aria-checked");

    const forbidden: string[] = [];
    const onRequest = (request: import("@playwright/test").Request) => {
      if (isForbiddenDisabledRuntimeRequest(request)) {
        const { pathname } = new URL(request.url());
        forbidden.push(`${request.method()} ${pathname}`);
      }
    };

    try {
      if (wasEnabled === "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      expect(await enabledKey(page)).toBe(key);

      const countsBeforeReload = { ...runtime.counts };
      page.on("request", onRequest);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("switch", { name: "Enable floating bar" })).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      expect(forbidden).toEqual([]);
      expect(runtime.counts).toEqual(countsBeforeReload);
    } finally {
      page.off("request", onRequest);
      await restoreScopedPreferences(page, [{ key, value: originalEnabled }]);
    }
  });

  test("reports a failed scoped preference write as unsaved and restores the saved value on reload", async ({ page }) => {
    await installMockBarRuntime(page);
    await openAuthenticatedSettings(page);
    const key = await enabledKey(page);
    const originalValue = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
    const toggle = page.getByRole("switch", { name: "Enable floating bar" });

    try {
      if (await toggle.getAttribute("aria-checked") !== "true") {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "true");
      }

      await page.evaluate((storageKey) => localStorage.setItem(storageKey, "1"), key);
      await blockScopedPreferenceWrite(page, key);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(page.getByRole("alert")).toContainText(
        "Changed for this tab, but could not save. Reloading may restore your previous setting.",
      );
      expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe("1");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("switch", { name: "Enable floating bar" })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe("1");
    } finally {
      await restoreStorageWriteMethod(page);
      await restoreScopedPreferences(page, [{ key, value: originalValue }]);
    }
  });

  test("settings switch is usable at 390px and 820px without horizontal overflow", async ({ page }) => {
    await openAuthenticatedSettings(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 900 }]) {
      await page.setViewportSize(viewport);
      const toggle = page.getByRole("switch", { name: "Enable floating bar" });
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeEnabled();
      const dimensions = await page.evaluate(() => ({
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }));
      expect(dimensions.documentScrollWidth, `document overflow at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.documentClientWidth);
      expect(dimensions.bodyScrollWidth, `body overflow at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.bodyClientWidth);
    }
  });

  test("floating bar uses the build-time width config and stays responsive", async ({ page }) => {
    await openAuthenticatedSettings(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const bar = page.locator("[data-floating-kollabor-bar]");
    await expect(bar).toHaveCount(1);

    const configuredWidth = Number(process.env.E2E_BAR_WIDTH ?? "373");
    const measured = await page.evaluate((width) => {
      const element = document.querySelector<HTMLElement>("[data-floating-kollabor-bar]");
      return {
        configuredWidth: width,
        viewportWidth: window.innerWidth,
        renderedWidth: element?.getBoundingClientRect().width ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
      };
    }, configuredWidth);

    expect(measured.renderedWidth).toBeCloseTo(
      Math.min(configuredWidth, measured.viewportWidth - 32),
      0,
    );
    expect(measured.scrollWidth).toBe(measured.viewportWidth);
  });

  test("settings width parameter updates the live bar and survives reload", async ({ page }) => {
    await openAuthenticatedSettings(page);
    const width = page.getByRole("spinbutton", { name: "Floating bar width in pixels" });
    const toggle = page.getByRole("switch", { name: "Enable floating bar" });
    const originalWidth = await width.inputValue();
    const originalEnabled = await toggle.getAttribute("aria-checked");

    await width.fill("480");
    await width.press("Tab");
    await expect(width).toHaveValue("480");
    await expect.poll(
      () => page.evaluate(() => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith("mentiko-kollabor-width:"));
        return key ? localStorage.getItem(key) : null;
      }),
    ).toBe("480");

    if (originalEnabled !== "true") {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
    }
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const bar = page.locator("[data-floating-kollabor-bar]");
    await expect(bar).toHaveCount(1);
    await expect.poll(
      () => page.evaluate(() => document.querySelector<HTMLElement>("[data-floating-kollabor-bar]")?.getBoundingClientRect().width ?? 0),
    ).toBeCloseTo(480, 0);

    await page.goto("/settings/mentiko-agent", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toHaveValue("480");

    const restoredWidth = page.getByRole("spinbutton", { name: "Floating bar width in pixels" });
    await restoredWidth.fill(originalWidth);
    await restoredWidth.press("Tab");
    if (originalEnabled !== "true") {
      await page.getByRole("switch", { name: "Enable floating bar" }).click();
      await expect(page.getByRole("switch", { name: "Enable floating bar" })).toHaveAttribute("aria-checked", "false");
    }
  });

  test("settings exposes tunable chat backdrop controls with scoped persistence", async ({ page }) => {
    await openAuthenticatedSettings(page);
    const backdropAccordion = page.getByRole("button", { name: "Backdrop" });
    const surfaceAccordion = page.getByRole("button", { name: "Chat surface" });
    await expect(backdropAccordion).toHaveAttribute("aria-expanded", "false");
    await expect(surfaceAccordion).toHaveAttribute("aria-expanded", "false");

    await backdropAccordion.click();
    await surfaceAccordion.click();
    await expect(backdropAccordion).toHaveAttribute("aria-expanded", "true");
    await expect(surfaceAccordion).toHaveAttribute("aria-expanded", "true");
    const switchControl = page.getByRole("switch", { name: "Enable chat backdrop" });
    const originalSwitch = await switchControl.getAttribute("aria-checked");
    const fields = [
      ["Backdrop blur value", "4"],
      ["Backdrop dimness value", "5"],
      ["Horizontal reach value", "300"],
      ["Vertical reach value", "420"],
      ["Edge softness value", "70"],
      ["Transcript height value", "50"],
      ["Corner radius value", "6"],
      ["Shadow strength value", "0"],
    ] as const;
    const originals = await Promise.all(fields.map(async ([label]) => [label, await page.getByRole("spinbutton", { name: label }).inputValue()] as const));

    await switchControl.click();
    await expect(switchControl).toHaveAttribute("aria-checked", originalSwitch === "true" ? "false" : "true");
    for (const [label, value] of fields) {
      const input = page.getByRole("spinbutton", { name: label });
      await input.fill(value);
      await input.press("Tab");
    }
    await expect.poll(
      () => page.evaluate(() => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith("mentiko-kollabor-appearance:"));
        const raw = key ? localStorage.getItem(key) : null;
        return raw ? JSON.parse(raw) : null;
      }),
    ).toMatchObject({ backdropBlur: 4, backdropDim: 5, backdropWidth: 300, backdropHeight: 420, surfaceShadow: 0 });

    for (const [label, value] of originals) {
      const input = page.getByRole("spinbutton", { name: label });
      await input.fill(value);
      await input.press("Tab");
    }
    if (originalSwitch !== await switchControl.getAttribute("aria-checked")) {
      await switchControl.click();
    }
  });

  test("settings offers three appearance presets while keeping width independent", async ({ page }) => {
    await openAuthenticatedSettings(page);
    await expect(page.getByRole("heading", { name: "Backdrop" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chat surface" })).toBeVisible();
    const backdropAccordion = page.getByRole("button", { name: "Backdrop" });
    const surfaceAccordion = page.getByRole("button", { name: "Chat surface" });
    const width = page.getByRole("spinbutton", { name: "Floating bar width in pixels" });
    await expect(width).toBeEnabled();
    const originalWidth = await width.inputValue();
    const [originalWidthPreference, originalAppearancePreference] = await scopedWidthAndAppearanceSnapshot(page);

    const presets = [
      {
        name: "Minimal",
        values: {
          backdropEnabled: false,
          backdropBlur: 0,
          backdropDim: 0,
          backdropWidth: 360,
          backdropHeight: 600,
          backdropSoftness: 100,
          transcriptMaxHeight: 60,
          surfaceRadius: 10,
          surfaceShadow: 0,
        },
      },
      {
        name: "Balanced",
        values: {
          backdropEnabled: true,
          backdropBlur: 20,
          backdropDim: 22,
          backdropWidth: 540,
          backdropHeight: 900,
          backdropSoftness: 90,
          transcriptMaxHeight: 78,
          surfaceRadius: 16,
          surfaceShadow: 18,
        },
      },
      {
        name: "Focused",
        values: {
          backdropEnabled: true,
          backdropBlur: 30,
          backdropDim: 34,
          backdropWidth: 700,
          backdropHeight: 1100,
          backdropSoftness: 70,
          transcriptMaxHeight: 82,
          surfaceRadius: 20,
          surfaceShadow: 28,
        },
      },
    ] as const;

    try {
      await expect(backdropAccordion).toHaveAttribute("aria-expanded", "false");
      await expect(surfaceAccordion).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("slider", { name: "Backdrop blur" })).toBeHidden();
      await expect(page.getByRole("slider", { name: "Transcript height" })).toBeHidden();

      await backdropAccordion.click();
      await expect(backdropAccordion).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("slider", { name: "Backdrop blur" })).toBeVisible();
      await surfaceAccordion.click();
      await expect(surfaceAccordion).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("slider", { name: "Transcript height" })).toBeVisible();

      await backdropAccordion.click();
      await expect(backdropAccordion).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("slider", { name: "Backdrop blur" })).toBeHidden();
      await backdropAccordion.click();
      await surfaceAccordion.click();
      await expect(surfaceAccordion).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("slider", { name: "Transcript height" })).toBeHidden();
      await surfaceAccordion.click();

      for (const preset of presets) {
        const button = page.getByRole("button", { name: `Use ${preset.name} appearance preset` });
        await expect(button).toBeEnabled();
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        for (const otherPreset of presets.filter(({ name }) => name !== preset.name)) {
          await expect(page.getByRole("button", { name: `Use ${otherPreset.name} appearance preset` }))
            .toHaveAttribute("aria-pressed", "false");
        }

        await expect(width).toHaveValue(originalWidth);
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), originalWidthPreference.key))
          .toBe(originalWidthPreference.value);
        await expect.poll(
          () => page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
          }, originalAppearancePreference.key),
        ).toEqual(preset.values);
      }
    } finally {
      await restoreScopedPreferences(page, [originalWidthPreference, originalAppearancePreference]);
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    await expect(page.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toHaveValue(originalWidth);
  });

  test("settings backdrop and chat surface accordions expand and collapse without changing values", async ({ page }) => {
    test.skip(
      !process.env.E2E_BAR_EMAIL || !process.env.E2E_BAR_PASSWORD,
      "set E2E_BAR_EMAIL and E2E_BAR_PASSWORD for authenticated bar E2E",
    );
    await openAuthenticatedSettings(page);
    const backdrop = page.getByRole("button", { name: "Backdrop" });
    const chatSurface = page.getByRole("button", { name: "Chat surface" });
    const backdropFields = [
      "Backdrop blur value",
      "Backdrop dimness value",
      "Horizontal reach value",
      "Vertical reach value",
      "Edge softness value",
    ];
    const chatSurfaceFields = ["Transcript height value", "Corner radius value", "Shadow strength value"];
    const preferenceSnapshot = await scopedWidthAndAppearanceSnapshot(page);

    try {
      await expect(backdrop).toHaveAttribute("aria-expanded", "false");
      await expect(chatSurface).toHaveAttribute("aria-expanded", "false");
      for (const field of [...backdropFields, ...chatSurfaceFields]) {
        await expect(page.getByRole("spinbutton", { name: field })).toBeHidden();
      }

      await backdrop.click();
      await expect(backdrop).toHaveAttribute("aria-expanded", "true");
      for (const field of backdropFields) {
        await expect(page.getByRole("spinbutton", { name: field })).toBeVisible();
      }

      await chatSurface.click();
      await expect(chatSurface).toHaveAttribute("aria-expanded", "true");
      for (const field of chatSurfaceFields) {
        await expect(page.getByRole("spinbutton", { name: field })).toBeVisible();
      }
      const visibleValues = await Promise.all(
        [...backdropFields, ...chatSurfaceFields].map(async (field) =>
          page.getByRole("spinbutton", { name: field }).inputValue(),
        ),
      );

      await backdrop.click();
      await expect(backdrop).toHaveAttribute("aria-expanded", "false");
      for (const field of backdropFields) {
        await expect(page.getByRole("spinbutton", { name: field })).toBeHidden();
      }
      await chatSurface.click();
      await expect(chatSurface).toHaveAttribute("aria-expanded", "false");
      for (const field of chatSurfaceFields) {
        await expect(page.getByRole("spinbutton", { name: field })).toBeHidden();
      }

      await backdrop.click();
      await chatSurface.click();
      const valuesAfterReopen = await Promise.all(
        [...backdropFields, ...chatSurfaceFields].map(async (field) =>
          page.getByRole("spinbutton", { name: field }).inputValue(),
        ),
      );
      expect(valuesAfterReopen).toEqual(visibleValues);
      const preferencesAfterExpansion = await page.evaluate((entries) =>
        entries.map(({ key }) => ({ key, value: localStorage.getItem(key) })), preferenceSnapshot,
      );
      expect(preferencesAfterExpansion).toEqual(preferenceSnapshot);

      await backdrop.click();
      await chatSurface.click();
      await expect(backdrop).toHaveAttribute("aria-expanded", "false");
      await expect(chatSurface).toHaveAttribute("aria-expanded", "false");
    } finally {
      await restoreScopedPreferences(page, preferenceSnapshot);
    }
  });

  test("embedded settings iframe acknowledges failed scoped writes to sibling panels", async ({ page }) => {
    test.skip(
      !process.env.E2E_BAR_EMAIL || !process.env.E2E_BAR_PASSWORD,
      "set E2E_BAR_EMAIL and E2E_BAR_PASSWORD for authenticated bar E2E",
    );
    await installMockBarRuntime(page);
    await openAuthenticatedSettings(page);
    const scope = await activeAuthenticatedScope(page);
    const widthKey = `mentiko-kollabor-width:${scope}`;
    const originalWidthPreference = await page.evaluate((key) => localStorage.getItem(key), widthKey);
    const originalWidth = await page.getByRole("spinbutton", { name: "Floating bar width in pixels" }).inputValue();
    const nextWidth = String(Number(originalWidth) === 720 ? 719 : Number(originalWidth) + 1);

    try {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("open-floating-app-panel", {
          detail: { href: "/settings/mentiko-agent", title: "Mentiko Agent" },
        }));
        window.dispatchEvent(new CustomEvent("open-floating-app-panel", {
          detail: { href: "/settings/mentiko-agent#e2e-write-failure-sibling", title: "Mentiko Agent sibling" },
        }));
      });

      const frame = page.frameLocator('iframe[title="Mentiko Agent panel"]');
      const siblingFrame = page.frameLocator('iframe[title="Mentiko Agent sibling panel"]');
      const frameWidth = frame.getByRole("spinbutton", { name: "Floating bar width in pixels" });
      const siblingWidth = siblingFrame.getByRole("spinbutton", { name: "Floating bar width in pixels" });
      await expect(frameWidth).toBeVisible({ timeout: 15_000 });
      await expect(siblingWidth).toBeVisible({ timeout: 15_000 });
      await expect(frameWidth).toHaveValue(originalWidth);
      await expect(siblingWidth).toHaveValue(originalWidth);

      // The owner page performs the actual scoped write. Force only that
      // exact key to fail so the browser can verify the acknowledged,
      // in-memory state separately from persistence.
      await blockScopedPreferenceWrite(page, widthKey);
      await frameWidth.fill(nextWidth);

      await expect(frameWidth).toHaveValue(nextWidth);
      await expect(siblingWidth).toHaveValue(nextWidth);
      await expect(frame.getByRole("alert")).toContainText(
        "Changed for this tab, but could not save. Reloading may restore your previous setting.",
      );
      await expect(siblingFrame.getByRole("alert")).toContainText(
        "Changed for this tab, but could not save. Reloading may restore your previous setting.",
      );
      expect(await page.evaluate((key) => localStorage.getItem(key), widthKey)).toBe(originalWidthPreference);
    } finally {
      await restoreStorageWriteMethod(page);
      await restoreScopedPreferences(page, [{ key: widthKey, value: originalWidthPreference }]);
    }
  });

  test("embedded settings iframe shares scope and fail-closes a held parent turn on receipt-only cancel", async ({ page }) => {
    const runtime = await installMockBarRuntime(page, "held-receipt-only");
    await openAuthenticatedSettings(page);
    const topToggle = page.getByRole("switch", { name: "Enable floating bar" });
    const topWidth = page.getByRole("spinbutton", { name: "Floating bar width in pixels" });
    await expect(topToggle).toBeEnabled();
    await expect(topWidth).toBeEnabled();
    const topScope = await activeAuthenticatedScope(page);
    const enabledPreferenceKey = `mentiko-kollabor-enabled:${topScope}`;
    const widthPreferenceKey = `mentiko-kollabor-width:${topScope}`;
    const pendingShutdownKey = `mentiko-kollabor-pending-shutdown:${topScope}`;
    const originalEnabledValue = await page.evaluate((key) => localStorage.getItem(key), enabledPreferenceKey);
    const originalWidthValue = await page.evaluate((key) => localStorage.getItem(key), widthPreferenceKey);
    const originalShutdownMarker = await page.evaluate((key) => localStorage.getItem(key), pendingShutdownKey);
    const originalWidth = await topWidth.inputValue();

    try {
      if (await topToggle.getAttribute("aria-checked") !== "true") {
        await topToggle.click();
        await expect(topToggle).toHaveAttribute("aria-checked", "true");
      }
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(1);
      await startHeldTurn(page, runtime, "hold a parent turn while disabling from its settings iframe");
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("open-floating-app-panel", {
          detail: { href: "/settings/mentiko-agent", title: "Mentiko Agent" },
        }));
        window.dispatchEvent(new CustomEvent("open-floating-app-panel", {
          detail: { href: "/settings/mentiko-agent#e2e-sibling-panel", title: "Mentiko Agent sibling" },
        }));
      });
      const frame = page.frameLocator('iframe[title="Mentiko Agent panel"]');
      const siblingFrame = page.frameLocator('iframe[title="Mentiko Agent sibling panel"]');
      const toggle = frame.getByRole("switch", { name: "Enable floating bar" });
      const siblingToggle = siblingFrame.getByRole("switch", { name: "Enable floating bar" });
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      await expect(siblingToggle).toBeVisible({ timeout: 15_000 });
      await expect(toggle).toBeEnabled();
      await expect(siblingToggle).toBeEnabled();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(siblingToggle).toHaveAttribute("aria-checked", "true");
      await expect(frame.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toHaveValue(originalWidth);
      await expect(siblingFrame.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toHaveValue(originalWidth);

      const panelFrames = page.frames().filter((candidate) =>
        candidate.url().includes("/settings/mentiko-agent?surface=panel"),
      );
      expect(panelFrames).toHaveLength(2);
      for (const panelFrame of panelFrames) {
        const panelScope = await panelFrame.evaluate(async () => {
          const scopeResponse = await fetch("/api/system/storage-scope", { cache: "no-store" });
          if (!scopeResponse.ok) throw new Error(`panel scope lookup failed: ${scopeResponse.status}`);
          const scopeBody = await scopeResponse.json();
          const sessionResponse = await fetch("/api/auth/get-session", { cache: "no-store" });
          if (!sessionResponse.ok) throw new Error(`panel session lookup failed: ${sessionResponse.status}`);
          const sessionBody = await sessionResponse.json();
          const installScope = scopeBody?.data?.storageScope;
          const userId = sessionBody?.user?.id ?? sessionBody?.data?.user?.id;
          if (typeof installScope !== "string" || typeof userId !== "string") {
            throw new Error("could not resolve the panel preference scope");
          }
          return `${installScope}:user:${userId}`;
        });
        expect(panelScope).toBe(topScope);
      }

      const heldMessageFailure = page.waitForEvent("requestfailed", {
        predicate: (request) => new URL(request.url()).pathname.endsWith("/message"),
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(siblingToggle).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      await runtime.cancelStarted.promise;
      expect(runtime.counts.cancels).toBe(1);
      const abortedMessage = await heldMessageFailure;
      expect(abortedMessage.failure()?.errorText).toMatch(/ERR_ABORTED|abort|cancel/i);
      expect(await page.evaluate((key) => localStorage.getItem(key), enabledPreferenceKey)).toBe("0");
      expect(await page.evaluate((key) => localStorage.getItem(key), widthPreferenceKey)).toBe(originalWidthValue);

      runtime.releaseCancel.resolve();
      await expect(frame.getByRole("alert")).toContainText(
        "safe shutdown retry requires turn-scoped, idempotent cancellation",
      );
      await expect(frame.getByRole("button", { name: "Retry stopping" })).toHaveCount(0);
      const markerAfterReceipt = await page.evaluate((key) => localStorage.getItem(key), pendingShutdownKey);
      expect(markerAfterReceipt).not.toBeNull();
      expect(JSON.parse(markerAfterReceipt!)).toMatchObject({ sessionId: runtime.sessionIds[0], scope: topScope });

      // Release the intercepted message only after the bar has unmounted. This
      // exercises the local late-result guard; it is not proof about engine work.
      runtime.releaseMessage.resolve();
      await runtime.messageSettled.promise;
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      expect(runtime.counts.creates).toBe(1);
      expect(runtime.counts.cancels).toBe(1);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
      await page.goto("/settings/mentiko-agent", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("switch", { name: "Enable floating bar" })).toHaveAttribute("aria-checked", "false");
      await expect(page.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toHaveValue(originalWidth);
      expect(await page.evaluate((key) => localStorage.getItem(key), enabledPreferenceKey)).toBe("0");
      expect(await page.evaluate((key) => localStorage.getItem(key), pendingShutdownKey)).toBe(markerAfterReceipt);
    } finally {
      await restoreScopedPreferences(page, [
        { key: enabledPreferenceKey, value: originalEnabledValue },
        { key: widthPreferenceKey, value: originalWidthValue },
        { key: pendingShutdownKey, value: originalShutdownMarker },
      ]);
    }
  });

  test("standalone panel settings route mounts no runtime", async ({ page }) => {
    await openAuthenticatedSettings(page);
    await page.goto("/settings/mentiko-agent?surface=panel", { waitUntil: "networkidle" });
    await expect(page.getByRole("switch", { name: "Enable floating bar" })).toBeVisible();
    await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);
  });
});

test.describe("floating bar deployment-off build", () => {
  test("deployment-off build keeps settings visible, authenticates, and hides the dashboard opener", async ({ page }) => {
    const offBaseUrl = process.env.E2E_BAR_OFF_URL;
    test.skip(!offBaseUrl, "set E2E_BAR_OFF_URL to an already-built NEXT_PUBLIC_KOLLABOR_BAR=0 runtime");
    await openAuthenticatedSettingsAt(page, offBaseUrl!);
    await expect(page.getByRole("switch", { name: "Enable floating bar" })).toBeDisabled();
    await expect(page.getByText("Your deployment has disabled the Mentiko bar. Your saved preference will apply if the deployment enables it again.")).toBeVisible();
    await expect(page.locator("[data-floating-kollabor-bar]")).toHaveCount(0);

    await page.goto(new URL("/dashboard", offBaseUrl).href, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/^(all systems go|degraded|unhealthy|unknown)$/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "ask mentiko", exact: true })).toHaveCount(0);
  });

  test("deployment-off build blocks UI-grant approval POST and keeps data approval working", async ({ page }) => {
    const offBaseUrl = process.env.E2E_BAR_OFF_URL;
    test.skip(!offBaseUrl, "set E2E_BAR_OFF_URL to an already-built NEXT_PUBLIC_KOLLABOR_BAR=0 runtime");
    await openAuthenticatedSettingsAt(page, offBaseUrl!);
    await expect(page.getByRole("switch", { name: "Enable floating bar" })).toBeDisabled();

    const approvalPosts: Array<Record<string, unknown>> = [];
    await page.route("**/api/mentiko-mcp/auth/device/info**", async (route) => {
      const code = new URL(route.request().url()).searchParams.get("code");
      const uiGrant = code === "E2E-UI-GRANT";
      await route.fulfill({
        json: {
          user_code: uiGrant ? "ABCD-EFGH" : "IJKL-MNOP",
          client_label: uiGrant ? "UI agent" : "Data client",
          scopes: uiGrant ? [] : ["ops:read"],
          grant_kind: uiGrant ? "ui" : "data",
          status: "pending",
          expired: false,
        },
      });
    });
    await page.route("**/api/mentiko-mcp/auth/device/approve", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      approvalPosts.push(body);
      await route.fulfill({ json: { ok: true, decision: body.decision, kind: "data" } });
    });

    await page.goto(new URL("/mcp-auth?code=E2E-UI-GRANT", offBaseUrl).href, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Authorize Mentiko access" })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("The Mentiko bar is off - enable it in Settings -> Mentiko Agent.")).toBeVisible();
    expect(approvalPosts).toHaveLength(0);

    await page.goto(new URL("/mcp-auth?code=E2E-DATA-GRANT", offBaseUrl).href, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Authorize Mentiko access" })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
    expect(approvalPosts).toEqual([{ user_code: "E2E-DATA-GRANT", decision: "approve" }]);
  });
});
