/**
 * Operations Timeline e2e — seeds the isolated e2e data root with one example
 * of every operational state the spec demands, then verifies /activity,
 * /tasks row indicators, and the read-model API against that seeded truth.
 *
 * Automation safety: the ephemeral dev server runs the real background worker,
 * so every seeded state is deliberately non-dispatchable — active runs pin the
 * concurrency cap (poller sees 0 slots and triggers nothing), the errored task
 * has auto-run off (no autonomous audit/retry), and blocked tasks fail
 * dependency readiness. Nothing here can launch a real agent CLI.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { AuthHelpers } from "../helpers/auth-helpers";

const SHOT_DIR = "/private/tmp/claude-501/-Users-malmazan-dev-platform/19a6de93-c570-4a71-95c9-185dcde26bcf/scratchpad/ops-e2e";

interface SeededIds {
  running: string;
  errored: string;
  downstream: string;
  blocked: string;
  queued: string;
  decision: string;
  completed: string;
}

const seeded: SeededIds = {
  running: "", errored: "", downstream: "", blocked: "", queued: "", decision: "", completed: "",
};

function writeRun(runsDir: string, id: string, record: Record<string, unknown>, artifacts?: Record<string, string>) {
  const dir = join(runsDir, id);
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({ id, ...record }, null, 2));
  for (const [name, content] of Object.entries(artifacts ?? {})) {
    writeFileSync(join(dir, "artifacts", name), content);
  }
}

async function createTask(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post("/api/tasks/create", { data: body });
  expect(res.ok(), `create task ${JSON.stringify(body)} -> ${res.status()}`).toBeTruthy();
  const json = await res.json();
  const id = json?.data?.issue?.id ?? json?.issue?.id ?? json?.data?.task?.id ?? json?.data?.id;
  expect(id, `task id in ${JSON.stringify(json).slice(0, 200)}`).toBeTruthy();
  return id as string;
}

async function patchTask(page: Page, id: string, fields: Record<string, unknown>) {
  const res = await page.request.patch(`/api/tasks/${encodeURIComponent(id)}`, {
    data: {
      ...fields,
      ...(fields.metadata ? { metadata: JSON.stringify(fields.metadata) } : {}),
    },
  });
  expect(res.ok(), `patch ${id} -> ${res.status()}`).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.describe("Operations Timeline", () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    const context = await browser.newContext({ colorScheme: "dark" });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const auth = new AuthHelpers(page);
    await auth.signUp();

    const root = process.env.MENTIKO_GLOBAL_ROOT;
    expect(root, "MENTIKO_GLOBAL_ROOT must point at the e2e temp root").toBeTruthy();
    const runsDir = join(root!, "namespaces", "default", "runs");
    mkdirSync(runsDir, { recursive: true });

    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

    // ---- tasks ----
    seeded.running = await createTask(page, { title: "Ops seed: running deploy", type: "task", priority: 1 });
    seeded.errored = await createTask(page, { title: "Ops seed: failed migration", type: "task", priority: 1 });
    seeded.downstream = await createTask(page, { title: "Ops seed: blocked by failure", type: "task", priority: 2 });
    seeded.blocked = await createTask(page, { title: "Ops seed: waiting on deploy", type: "task", priority: 2 });
    seeded.queued = await createTask(page, { title: "Ops seed: ready for capacity", type: "task", priority: 0 });
    seeded.decision = await createTask(page, { title: "Ops seed: choose rollout strategy", type: "decision", priority: 1 });
    seeded.completed = await createTask(page, { title: "Ops seed: audited completion", type: "task", priority: 2 });

    // dependencies: downstream <- errored, blocked <- running, queued <- completed(closed)
    for (const [from, to] of [
      [seeded.downstream, seeded.errored],
      [seeded.blocked, seeded.running],
      [seeded.queued, seeded.completed],
    ]) {
      const res = await page.request.post("/api/tasks/deps", { data: { from, to } });
      expect(res.ok(), `dep ${from}->${to}`).toBeTruthy();
    }

    // running: live claim + in_progress
    await patchTask(page, seeded.running, {
      status: "in_progress",
      metadata: {
        auto_run: true,
        chain_id: "ops-demo-chain",
        chain_name: "Ops Demo Chain",
        last_run_id: "run-OPSLIVE1",
        last_run_status: "running",
        last_run_started: iso(-5 * 60 * 1000),
      },
    });

    // errored: failed execution, auto-run OFF (no autonomous retry/audit)
    await patchTask(page, seeded.errored, {
      status: "in_progress",
      metadata: {
        auto_run: false,
        chain_id: "ops-demo-chain",
        chain_name: "Ops Demo Chain",
        last_run_id: "run-OPSFAIL1",
        last_run_status: "failed",
        last_run_error: "exit 1: migration step crashed",
        execution_retries: 2,
      },
    });

    // queued/blocked/downstream: auto-run on, no chain
    for (const id of [seeded.queued, seeded.blocked, seeded.downstream]) {
      await patchTask(page, id, { metadata: { auto_run: true } });
    }

    // completed: audited close with summary + evidence + source run
    await patchTask(page, seeded.completed, {
      metadata: {
        auto_run: true,
        chain_id: "ops-demo-chain",
        chain_name: "Ops Demo Chain",
        last_run_id: "run-OPSDONE1",
        last_run_status: "completed",
        last_audit_verdict: "close",
        completion_audit_apply_status: "applied",
        task_outcome_summary_source_run_id: "run-OPSDONE1",
        task_outcome_summary: {
          headline: "Shipped the seeded ops example end to end",
          narrative: "The demo chain ran, produced artifacts, and passed its completion audit.",
          outcome: "complete",
          what_happened: ["executed ops-demo-chain", "wrote report.md"],
          evidence: ["artifacts/report.md"],
          improvement_signals: ["No orchestration issue detected."],
          next_actions: [],
        },
      },
    });
    const closeRes = await page.request.post(`/api/tasks/${encodeURIComponent(seeded.completed)}/close`);
    expect(closeRes.ok()).toBeTruthy();

    // ---- runs on disk (isolated temp root) ----
    const liveAgents = [
      { id: "builder", name: "Builder", session: "s1", status: "running", started: iso(-4 * 60 * 1000) },
      { id: "verifier", name: "Verifier", session: "s2", status: "pending" },
    ];
    writeRun(runsDir, "run-OPSLIVE1", {
      chain: "Ops Demo Chain", chainId: "ops-demo-chain", goal: "seeded live run",
      started: iso(-5 * 60 * 1000), status: "running", taskId: seeded.running, agents: liveAgents,
    });
    // four taskless fillers pin the concurrency cap (5) -> 0 free slots
    for (let i = 1; i <= 4; i += 1) {
      writeRun(runsDir, `run-OPSFILL${i}`, {
        chain: `Capacity Filler ${i}`, goal: "hold a slot",
        started: iso(-3 * 60 * 1000), status: "running",
        agents: [{ id: "a", name: "A", session: `f${i}`, status: "running", started: iso(-3 * 60 * 1000) }],
      });
    }
    writeRun(runsDir, "run-OPSFAIL1", {
      chain: "Ops Demo Chain", chainId: "ops-demo-chain", goal: "seeded failed run",
      started: iso(-40 * 60 * 1000), completed: iso(-30 * 60 * 1000), status: "failed",
      status_message: "agent exited 1", taskId: seeded.errored,
      agents: [{ id: "builder", name: "Builder", session: "s3", status: "failed" }],
    });
    writeRun(runsDir, "run-OPSDONE1", {
      chain: "Ops Demo Chain", chainId: "ops-demo-chain", goal: "seeded completed run",
      started: iso(-90 * 60 * 1000), completed: iso(-80 * 60 * 1000), status: "completed",
      taskId: seeded.completed,
      agents: [{ id: "builder", name: "Builder", session: "s4", status: "complete", completed: iso(-80 * 60 * 1000) }],
    }, {
      "report.md": "# Ops seed report\nEverything worked.",
      "builder-summary.json": JSON.stringify({ summary: "built the thing" }),
    });
    writeRun(runsDir, "run-OPSREAP1", {
      chain: "Ops Demo Chain", chainId: "ops-demo-chain", goal: "seeded dead run",
      started: iso(-120 * 60 * 1000), completed: iso(-60 * 60 * 1000), status: "failed",
      status_message: "reaped: no agent liveness for >45m (dead session); freed concurrency slot",
      agents: [{ id: "builder", name: "Builder", session: "s5", status: "failed" }],
    });
  });

  test("read model reflects every seeded state truthfully", async () => {
    const res = await page.request.get("/api/operations/timeline");
    expect(res.ok()).toBeTruthy();
    const view = (await res.json()).data.view;

    const reasonById = new Map<string, string>(
      view.taskStates.map((s: { taskId: string; reason: string }) => [s.taskId, s.reason]),
    );
    expect(reasonById.get(seeded.running)).toBe("running");
    expect(reasonById.get(seeded.errored)).toBe("blocked_error");
    expect(reasonById.get(seeded.downstream)).toBe("blocked_failed_dependency");
    expect(reasonById.get(seeded.blocked)).toBe("blocked_dependency");
    expect(reasonById.get(seeded.queued)).toBe("queued_capacity"); // cap pinned at 5/5
    expect(reasonById.get(seeded.decision)).toBe("waiting_human_decision");
    expect(reasonById.get(seeded.completed)).toBe("closed");

    // blocking impact, both directions
    const errored = view.taskStates.find((s: { taskId: string }) => s.taskId === seeded.errored);
    expect(errored.blockedDownstreamTaskIds).toContain(seeded.downstream);
    const downstream = view.taskStates.find((s: { taskId: string }) => s.taskId === seeded.downstream);
    expect(downstream.blockingTaskIds).toContain(seeded.errored);

    // running now includes the seeded live run with agent counts
    const live = view.runningNow.find((r: { runId: string }) => r.runId === "run-OPSLIVE1");
    expect(live).toMatchObject({ taskId: seeded.running, agentsTotal: 2, kind: "execution" });
    expect(view.counts.runsActive).toBe(5);
    expect(view.counts.availableSlots).toBe(0);

    // expected next: queued task first (highest priority admitted)
    expect(view.upNext[0].taskId).toBe(seeded.queued);
    expect(view.upNext[0].reason).toBe("queued_capacity");

    // accomplishments: audited close with artifacts + unlocked downstream
    const done = view.recentAccomplishments.find((a: { taskId: string }) => a.taskId === seeded.completed);
    expect(done).toBeTruthy();
    expect(done.headline).toContain("Shipped the seeded ops example");
    expect(done.artifactCount).toBeGreaterThan(0);
    expect(done.artifacts.map((a: { name: string }) => a.name)).toContain("report.md");
    expect(done.unlockedTaskIds).toContain(seeded.queued);

    // human gate present for the decision task
    expect(view.humanGates.some((g: { taskId?: string }) => g.taskId === seeded.decision)).toBeTruthy();

    // timeline carries the recovery + the failed run from persisted state
    const kinds = new Set(view.timeline.map((t: { kind: string }) => t.kind));
    expect(kinds.has("run_reaped")).toBeTruthy();
    expect(kinds.has("run_failed")).toBeTruthy();
    expect(kinds.has("task_closed")).toBeTruthy();

    // notifications persisted idempotently for the durable transitions
    const notifRes = await page.request.get("/api/notifications");
    const notifJson = await notifRes.json();
    const notifications = notifJson?.data?.notifications ?? notifJson?.notifications ?? [];
    const errorNotif = notifications.find(
      (n: { type: string; metadata?: { taskId?: string } }) =>
        n.type === "task_error" && n.metadata?.taskId === seeded.errored,
    );
    expect(errorNotif, "task_error notification for the seeded failure").toBeTruthy();
    const decisionNotifs = notifications.filter(
      (n: { type: string; metadata?: { taskId?: string } }) =>
        n.type === "decision_required" && n.metadata?.taskId === seeded.decision,
    );
    expect(decisionNotifs.length).toBe(1); // idempotent across the polls above
  });

  test("/activity renders the operations view against seeded state", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/activity");
    await expect(page.getByText("Running Now")).toBeVisible({ timeout: 20_000 });

    // system strip
    await expect(page.getByText(/5\/5 run slots in use/)).toBeVisible();
    // attention with downstream impact
    await expect(page.getByText(`${seeded.errored}: Ops seed: failed migration`)).toBeVisible();
    await expect(page.getByText(/blocking 1 downstream/)).toBeVisible();
    // running now
    await expect(page.getByText("Expected Next")).toBeVisible();
    await expect(
      page.locator("section", { hasText: "Expected Next" }).getByText("Ops seed: ready for capacity"),
    ).toBeVisible();
    // waiting groups
    await expect(page.getByRole("heading", { name: "Dependencies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Capacity" })).toBeVisible();
    // human gate
    await expect(
      page.locator("section", { hasText: "Human Gates" }).getByText("Ops seed: choose rollout strategy"),
    ).toBeVisible();
    // accomplishment with evidence + artifacts
    await expect(page.getByText("Shipped the seeded ops example end to end")).toBeVisible();
    await expect(page.getByText(/report\.md/).first()).toBeVisible();

    await page.screenshot({ path: join(SHOT_DIR, "activity-desktop.png"), fullPage: false });

    // timeline items link to real surfaces
    await expect(page.getByText("Recovered dead run: Ops Demo Chain").first()).toBeVisible();

    // 820px
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: join(SHOT_DIR, "activity-820.png") });

    // 390px — sidebar collapses, mobile timeline section renders
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: join(SHOT_DIR, "activity-390.png") });

    // legacy feed is preserved behind the toggle
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByText("Feed", { exact: true }).click();
    await expect(page.getByText("Chains", { exact: true })).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "activity-feed.png") });
  });

  test("/tasks rows carry distinct operational indicators", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tasks");
    await expect(page.getByText("Ops seed: failed migration")).toBeVisible({ timeout: 20_000 });

    // failed task: danger chip with causal tooltip
    await expect(page.locator(`[title*="migration step crashed"]`).first()).toBeVisible();
    // errored task also blocks downstream: blocks chip
    await expect(page.locator(`[title*="Blocking 1 open downstream task"]`).first()).toBeVisible();
    // blocked task: blocked-by chip naming the blocker
    await expect(page.locator(`[title*="Waiting for ${seeded.running}"]`).first()).toBeVisible();
    // queued task: expected-next chip with position
    await expect(page.locator(`[title*="Expected next (position 1)"]`).first()).toBeVisible();

    await page.screenshot({ path: join(SHOT_DIR, "tasks-indicators.png") });

    // 390px tasks list
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: join(SHOT_DIR, "tasks-390.png") });
  });

  test("no console errors on the operations surfaces", async () => {
    const real = consoleErrors.filter(
      (text) => !text.includes("favicon") && !text.includes("WebSocket") && !text.includes("net::ERR"),
    );
    expect(real, real.join("\n")).toEqual([]);
  });
});
