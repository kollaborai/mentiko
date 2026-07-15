import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvalRequestPath,
  createApprovalRequest,
  readApprovalRequest,
  updateApprovalRequest,
  validateApprovalRequest,
  validateRawApprovalRequest,
  waitForApproval,
  writeApprovalRequest,
} from "@/lib/runner-v2/approval-gate";

describe("typed approval gate", () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mentiko-approval-gate-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("writes one validated request atomically and reads the same canonical shape", () => {
    const request = createApprovalRequest({
      approvalsDir: join(root, "approvals"),
      chainId: "chain-1",
      runId: "run-1",
      agentName: "writer",
      stepName: "writer",
      action: "publish",
      description: "description with \"quotes\"",
      timeoutMinutes: 5,
      requestId: "request-1",
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    writeApprovalRequest(join(root, "approvals"), request);
    expect(readApprovalRequest(join(root, "approvals"), "request-1")).toEqual(request);
    expect(JSON.parse(readFileSync(join(root, "approvals", "requests.jsonl"), "utf8").trim())).toEqual(request);
  });

  it("polls typed status and returns approved without shell sleep or JSON parsing", async () => {
    const approvalsDir = join(root, "approvals");
    let slept = false;
    const result = await waitForApproval({
      approvalsDir,
      chainId: "chain-1",
      runId: "run-1",
      agentName: "writer",
      stepName: "writer",
      action: "publish",
      description: "publish report",
      timeoutMinutes: 1,
      requestId: "request-2",
      pollIntervalMs: 1,
    }, () => undefined, async () => {
      slept = true;
      const current = readApprovalRequest(approvalsDir, "request-2");
      updateApprovalRequest(approvalsDir, { ...current, status: "approved", approvedBy: "marco", approvedAt: new Date().toISOString() });
    });
    expect(slept).toBe(true);
    expect(result.code).toBe(0);
    expect(result.request.approvedBy).toBe("marco");
  });

  it("marks pending requests cancelled at the typed timeout boundary", async () => {
    const result = await waitForApproval({
      approvalsDir: join(root, "approvals"),
      chainId: "chain-1",
      runId: "run-1",
      agentName: "writer",
      stepName: "writer",
      action: "publish",
      description: "publish report",
      timeoutMinutes: 0,
      requestId: "request-3",
      pollIntervalMs: 0,
    }, () => undefined, async () => undefined);
    expect(result.code).toBe(2);
    expect(readApprovalRequest(join(root, "approvals"), "request-3").rejectionReason).toBe("timed out");
  });

  it("separates raw JSON validation from normalized approval validation and rejects symlink records", () => {
    expect(validateRawApprovalRequest("not json")).toMatchObject({ valid: false, issues: [{ code: "invalid-json" }] });
    expect(validateRawApprovalRequest("[]")).toMatchObject({ valid: false, issues: [{ code: "invalid-root" }] });
    expect(validateApprovalRequest({ status: "pending" })).toMatchObject({ valid: false });
    const approvalsDir = join(root, "approvals");
    mkdirSync(approvalsDir, { recursive: true });
    const target = join(root, "outside.json");
    writeFileSync(target, "{}");
    symlinkSync(target, join(approvalsDir, "request-link.json"));
    expect(() => approvalRequestPath(approvalsDir, "request-link")).not.toThrow();
    expect(() => readApprovalRequest(approvalsDir, "request-link")).toThrow("regular file");
  });
});
