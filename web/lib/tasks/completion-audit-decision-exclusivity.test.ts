/**
 * @jest-environment node
 *
 * Issue #120 bug E: decision creation from a completion audit must be
 * exactly-once and repairable. Integration tests against the REAL task store
 * and REAL decision storage (temp global root); only network/agent side
 * effects are mocked.
 */

jest.mock("@/lib/config", () => {
  const path = require("path");
  const os = require("os");
  const globalRoot = path.join(os.tmpdir(), `mentiko-exclusivity-${process.pid}-${Date.now()}`);
  return {
    __esModule: true,
    default: { globalRoot, codeRoot: "/tmp" },
    encodeProjectPath: (dir: string) => dir.replace(/\//g, "-"),
    nsPath: (nsId: string, ...segments: string[]) => path.join(globalRoot, "namespaces", nsId, ...segments),
    orgPath: (nsId: string, oId: string, ...segments: string[]) =>
      path.join(globalRoot, "namespaces", nsId, ...(oId === "default" ? [] : ["orgs", oId]), ...segments),
  };
});

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(),
}));

jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionResearch: jest.fn().mockResolvedValue(undefined),
}));

// task-store stays REAL (spread from the actual module); only taskAddDep is
// interceptable so a test can simulate its failure once. Module getters are
// non-configurable, so jest.spyOn on the namespace object cannot work here.
const mockTaskAddDep = jest.fn();
jest.mock("@/lib/tasks/task-store", () => {
  const actual = jest.requireActual("@/lib/tasks/task-store");
  return {
    ...actual,
    taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
  };
});

import { applyCompletionAudit } from "./completion-audit-apply";
import { listDecisions } from "@/lib/decisions/decision-storage";
import * as taskStore from "./task-store";
import type { CompletionAudit } from "./completion-audit-schema";

// Default: taskAddDep passes through to the real store. jest.mock factories
// cannot touch this const at registration time, so wire it after imports.
const actualTaskStore = jest.requireActual("@/lib/tasks/task-store") as typeof taskStore;
mockTaskAddDep.mockImplementation((...args: Parameters<typeof taskStore.taskAddDep>) =>
  actualTaskStore.taskAddDep(...args));

const ORG = "default";
const NS = "default";

function decisionAudit(): CompletionAudit {
  return {
    verdict: "decision",
    reason: "Needs human input.",
    decision: { prompt: "Which path?" },
  };
}

function completionAuditDecisionChildren(parentId: string) {
  return taskStore.taskList(ORG, { status: "all" }, undefined, NS).filter((task) =>
    task.parent_id === parentId
    && task.issue_type === "decision"
    && (task.metadata as Record<string, unknown>)?.decision_source === "completion-audit");
}

afterAll(() => {
  taskStore.closeAll();
});

describe("completion-audit decision creation is exactly-once and repairable (issue #120 bug E)", () => {
  it("two overlapping applyCompletionAudit calls for the same task/run create exactly one decision", async () => {
    const parent = taskStore.taskCreate(ORG, { title: "Parent", issue_type: "task" }, NS);

    const [a, b] = await Promise.all([
      applyCompletionAudit({
        request: {} as Request,
        namespaceId: NS,
        orgId: ORG,
        task: taskStore.taskGet(ORG, parent.id, NS)!,
        audit: decisionAudit(),
        runId: "run-x",
        runFingerprint: undefined,
        metadata: {},
      }),
      applyCompletionAudit({
        request: {} as Request,
        namespaceId: NS,
        orgId: ORG,
        task: taskStore.taskGet(ORG, parent.id, NS)!,
        audit: decisionAudit(),
        runId: "run-x",
        runFingerprint: undefined,
        metadata: {},
      }),
    ]);

    expect(completionAuditDecisionChildren(parent.id)).toHaveLength(1);
    expect(listDecisions(NS, ORG)).toHaveLength(1);
    const onlyDecisionTaskId = completionAuditDecisionChildren(parent.id)[0].id;
    expect([a.decisionTaskId, b.decisionTaskId]).toEqual(
      expect.arrayContaining([onlyDecisionTaskId, onlyDecisionTaskId]),
    );
  });

  it("repairs a decision that exists without its dependency when taskAddDep failed on the first pass", async () => {
    const parent = taskStore.taskCreate(ORG, { title: "Parent two", issue_type: "task" }, NS);
    const input = () => ({
      request: {} as Request,
      namespaceId: NS,
      orgId: ORG,
      task: taskStore.taskGet(ORG, parent.id, NS)!,
      audit: decisionAudit(),
      runId: "run-y",
      runFingerprint: "completed:t1",
      metadata: (taskStore.taskGet(ORG, parent.id, NS)!.metadata ?? {}) as Record<string, unknown>,
    });

    mockTaskAddDep.mockImplementationOnce(() => {
      throw new Error("workspace mismatch (simulated)");
    });
    await expect(applyCompletionAudit(input())).rejects.toThrow("workspace mismatch");

    // The decision subtask exists, but the parent dependency does not, and the
    // applied marker must not have been persisted for the failed pass.
    const children = completionAuditDecisionChildren(parent.id);
    expect(children).toHaveLength(1);
    expect(taskStore.taskGetAllDeps(ORG, NS).filter((dep) => dep.task_id === parent.id)).toHaveLength(0);
    expect(
      ((taskStore.taskGet(ORG, parent.id, NS)!.metadata ?? {}) as Record<string, unknown>).completion_audit_apply_status,
    ).not.toBe("applied");

    // A later pass repairs: dependency exists, still exactly one decision.
    const repaired = await applyCompletionAudit(input());
    expect(completionAuditDecisionChildren(parent.id)).toHaveLength(1);
    expect(listDecisions(NS, ORG).filter((decision) => decision.parentTaskId === parent.id)).toHaveLength(1);
    expect(repaired.decisionTaskId).toBe(children[0].id);
    expect(taskStore.taskGetAllDeps(ORG, NS).filter((dep) => dep.task_id === parent.id))
      .toEqual([{ task_id: parent.id, depends_on_id: children[0].id, type: "blocks" }]);
    const parentAfter = taskStore.taskGet(ORG, parent.id, NS)!;
    expect(parentAfter.status).toBe("blocked");
    expect((parentAfter.metadata as Record<string, unknown>).completion_audit_apply_status).toBe("applied");
  });
});
