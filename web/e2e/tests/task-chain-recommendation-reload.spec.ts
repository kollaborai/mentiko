import { test, expect, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function unwrapApiData<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    (payload as { data?: unknown }).data !== undefined
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function resolveGlobalRoot(): string {
  return (
    process.env.MENTIKO_GLOBAL_ROOT ||
    process.env.MENTIKO_ROOT ||
    path.join(os.homedir(), ".mentiko")
  );
}

async function resolveJobPaths(jobId: string): Promise<string[]> {
  const globalRoot = resolveGlobalRoot();
  const namespaceId = process.env.NAMESPACE_ID || "default";
  const namespacesRoot = path.join(globalRoot, "namespaces");
  const namespaceRoots = new Set<string>([
    process.env.MENTIKO_PROJECT_ROOT || path.join(namespacesRoot, namespaceId),
    path.join(namespacesRoot, "default"),
  ]);

  try {
    const entries = await fs.readdir(namespacesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        namespaceRoots.add(path.join(namespacesRoot, entry.name));
      }
    }
  } catch {
    // namespace root may not exist in a clean install yet
  }

  if (process.env.JOBS_DIR) {
    return [path.join(process.env.JOBS_DIR, `${jobId}.json`)];
  }
  return Array.from(namespaceRoots).map((root) => path.join(root, "jobs", `${jobId}.json`));
}

async function requestWithRetry<T>(
  action: () => Promise<T & { status: () => number }>,
  wait: (ms: number) => Promise<void>
): Promise<T & { status: () => number }> {
  let response = await action();
  for (let attempt = 0; response.status() === 429 && attempt < 5; attempt++) {
    await wait(1000 * (attempt + 1));
    response = await action();
  }
  return response;
}

async function ensureTaskUiAccess(page: Page): Promise<boolean> {
  await page.goto("/tasks?view=list");
  await page.waitForLoadState("networkidle");
  if (!page.url().includes("/login")) {
    return true;
  }

  const email =
    process.env.E2E_TEST_EMAIL ||
    `e2e-recommendation-reload-${Date.now()}@test.local`;
  const password = process.env.E2E_TEST_PASSWORD || "test-password-1234";

  if (process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD) {
    await page.goto("/login?redirect=%2Ftasks");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/tasks/, { timeout: 10000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    return !page.url().includes("/login");
  }

  await page.goto("/signup?redirect=%2Ftasks");
  await page.waitForLoadState("networkidle");
  if (await page.getByText("Invitation required").isVisible().catch(() => false)) {
    return false;
  }

  await page.getByPlaceholder("Name").fill("E2E Recommendation Reload");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByPlaceholder("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/tasks/, { timeout: 10000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle");

  return !page.url().includes("/login") && !page.url().includes("/signup");
}

async function activeWorkspaceParam(page: Page): Promise<string> {
  const fallbackPath = process.env.MENTIKO_CODE_ROOT || path.resolve(process.cwd(), "..");
  const fallbackParam = `?workspace=${encodeURIComponent(fallbackPath)}`;
  const response = await requestWithRetry(
    () => page.request.get("/api/workspaces"),
    (ms) => page.waitForTimeout(ms)
  );
  if (!response.ok()) return fallbackParam;

  const payload = unwrapApiData<{ workspaces?: Array<{ id: string; path?: string }> }>(
    await response.json()
  );
  const activeId = await page.evaluate(() => localStorage.getItem("mentiko-workspace"));
  const workspace =
    payload.workspaces?.find((item) => item.id === activeId) ||
    payload.workspaces?.[0];

  return workspace?.path ? `?workspace=${encodeURIComponent(workspace.path)}` : fallbackParam;
}

test.describe("task chain recommendation reload", () => {
  test("keeps a completed recommendation stable after reload", async ({ page }) => {
    const canAccessTasks = await ensureTaskUiAccess(page);
    test.skip(!canAccessTasks, "task UI requires configured e2e credentials or invite signup");

    await page.goto("/tasks?view=list&status=all");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible({ timeout: 10000 });

    const updateDepthErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" && text.includes("Maximum update depth exceeded")) {
        updateDepthErrors.push(text);
      }
    });
    page.on("pageerror", (error) => {
      const text = error.message;
      if (text.includes("Maximum update depth exceeded")) {
        updateDepthErrors.push(text);
      }
    });

    const title = `E2E completed recommendation reload ${Date.now()}`;
    const workspaceParam = await activeWorkspaceParam(page);
    const create = await requestWithRetry(
      () =>
        page.request.post(`/api/tasks/create${workspaceParam}`, {
          data: {
            title,
            description: "prove completed task chain analysis does not reapply metadata forever",
            type: "task",
            priority: 2,
          },
        }),
      (ms) => page.waitForTimeout(ms)
    );
    expect(create.ok()).toBeTruthy();

    const created = unwrapApiData<{ issue: { id: string } }>(await create.json());
    const taskId = created.issue.id;
    const jobId = `job-e2e-recommendation-reload-${Date.now()}`;
    const jobPaths = await resolveJobPaths(jobId);

    try {
      const timestamp = new Date().toISOString();
      const job = JSON.stringify(
        {
          id: jobId,
          type: "recommend",
          status: "complete",
          taskId,
          runId: `run-e2e-recommendation-reload-${Date.now()}`,
          chainId: "chain-recommendation",
          input: {},
          result: {
            recommendation: {
              action: "generate_new",
              reasoning: "The task needs a purpose-built chain for the reload regression.",
              suggested_name: "Reload Regression Chain",
              suggested_agents: [
                { name: "reload-checker", role: "verify completed recommendation reloads" },
              ],
              generation_prompt: "Create a chain for checking completed recommendation reloads.",
            },
            alternatives: [],
          },
          createdAt: timestamp,
          startedAt: timestamp,
          completedAt: timestamp,
        },
        null,
        2
      );
      for (const jobPath of jobPaths) {
        await fs.mkdir(path.dirname(jobPath), { recursive: true });
        await fs.writeFile(jobPath, job, "utf-8");
      }

      const patch = await requestWithRetry(
        () =>
          page.request.patch(`/api/tasks/${encodeURIComponent(taskId)}${workspaceParam}`, {
            data: {
              metadata: {
                analysis_job_id: jobId,
                analysis_status: "complete",
              },
            },
          }),
        (ms) => page.waitForTimeout(ms)
      );
      expect(patch.ok()).toBeTruthy();

      const taskQuery = `view=list&status=all&task=${encodeURIComponent(taskId)}${
        workspaceParam ? `&${workspaceParam.slice(1)}` : ""
      }`;
      await page.goto(`/tasks?${taskQuery}`);
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText("recommendation: generate new chain")).toBeVisible({
        timeout: 10000,
      });

      await page.reload();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText("recommendation: generate new chain")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText("Maximum update depth exceeded")).toHaveCount(0);
      expect(updateDepthErrors).toEqual([]);
    } finally {
      await page.request.post("/api/tasks/bulk", {
        data: { ids: [taskId], action: "delete" },
      }).catch(() => undefined);
      await Promise.all(jobPaths.map((jobPath) => fs.unlink(jobPath).catch(() => undefined)));
    }
  });
});
