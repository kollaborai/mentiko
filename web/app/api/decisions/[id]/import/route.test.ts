/**
 * @jest-environment node
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireInternalAuth = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getWorkspacePath = jest.fn();
const applyDecisionRunResult = jest.fn();
const advanceDecisionAfterPhase = jest.fn();
const resolveLinkRunPaths = jest.fn();

jest.mock("@/lib/auth/internal-api-auth", () => ({
  requireInternalAuth: (...args: unknown[]) => requireInternalAuth(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspacePath: (...args: unknown[]) => getWorkspacePath(...args),
}));
jest.mock("@/lib/decisions/decision-run-results", () => {
  const actual = jest.requireActual("@/lib/decisions/decision-run-results");
  return {
    ...actual,
    applyDecisionRunResult: (...args: unknown[]) => applyDecisionRunResult(...args),
  };
});
jest.mock("@/lib/decisions/decision-auto-advance", () => ({
  advanceDecisionAfterPhase: (...args: unknown[]) => advanceDecisionAfterPhase(...args),
}));
jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunPaths: (...args: unknown[]) => resolveLinkRunPaths(...args),
}));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(handler: T) => handler,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => ({ success: true, data }) }),
}));
jest.mock("@/lib/api-errors", () => ({
  BadRequest: class BadRequest extends Error {},
}));

import { POST } from "./route";

function request(body: unknown) {
  return {
    method: "POST",
    url: "http://localhost:3200/api/decisions/dec-x/import",
    headers: new Headers(),
    json: async () => body,
  } as never;
}

describe("POST /api/decisions/[id]/import", () => {
  let runsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    runsDir = mkdtempSync(join(tmpdir(), "decision-import-route-runs-"));
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue(undefined);
    applyDecisionRunResult.mockImplementation(async (input: { decisionId: string }) => ({
      id: input.decisionId,
      status: "resolved",
    }));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeRun(runId: string, metadata: Record<string, unknown>): string {
    const dir = join(runsDir, runId);
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({ id: runId, status: "completed", metadata }));
    resolveLinkRunPaths.mockImplementation((_ns: string, _org: string, id: string) => ({
      runsDir,
      runDir: join(runsDir, id),
      runJsonPath: join(runsDir, id, "run.json"),
      escalationsDir: join(runsDir, id, "escalations"),
    }));
    return dir;
  }

  it("trusts run.json's decisionId over a mismatched URL id when a runId is supplied", async () => {
    writeRun("run-plan-1", { decisionId: "dec-correct", decisionPhase: "plan" });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(
      request({ phase: "plan", runId: "run-plan-1", result: { summary: "s", tasks: [], dependencies: [] } }),
      { params: Promise.resolve({ id: "dec-WRONG-42d5" }) },
    ) as { status: number };

    expect(response.status).toBe(200);
    expect(applyDecisionRunResult).toHaveBeenCalledWith(expect.objectContaining({
      decisionId: "dec-correct",
      runId: "run-plan-1",
    }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dec-WRONG-42d5"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dec-correct"));
    warnSpy.mockRestore();
  });

  it("loads the result from decision-result.json when body.result is absent", async () => {
    const dir = writeRun("run-plan-2", { decisionId: "dec-correct", decisionPhase: "plan" });
    const diskResult = { summary: "from disk", tasks: [], dependencies: [] };
    writeFileSync(join(dir, "artifacts", "decision-result.json"), JSON.stringify(diskResult));

    await POST(
      request({ phase: "plan", runId: "run-plan-2" }),
      { params: Promise.resolve({ id: "dec-correct" }) },
    );

    expect(applyDecisionRunResult).toHaveBeenCalledWith(expect.objectContaining({ result: diskResult }));
  });

  it("still requires a result when neither body.result nor a run artifact is present", async () => {
    writeRun("run-plan-empty", { decisionId: "dec-correct", decisionPhase: "plan" });

    await expect(POST(
      request({ phase: "plan", runId: "run-plan-empty" }),
      { params: Promise.resolve({ id: "dec-correct" }) },
    )).rejects.toThrow("result is required");
    expect(applyDecisionRunResult).not.toHaveBeenCalled();
  });

  it("keeps existing callers unchanged: body.result + a correct URL id with no runId", async () => {
    const result = { summary: "s", tasks: [], dependencies: [] };

    await POST(
      request({ phase: "plan", result }),
      { params: Promise.resolve({ id: "dec-correct" }) },
    );

    expect(applyDecisionRunResult).toHaveBeenCalledWith(expect.objectContaining({
      decisionId: "dec-correct",
      result,
      runId: undefined,
    }));
  });

  it("double-import (CLI-style then completion-style) applies the same result twice without erroring or diverging", async () => {
    writeRun("run-plan-3", { decisionId: "dec-correct", decisionPhase: "plan" });
    const result = { summary: "s", tasks: [], dependencies: [] };
    const body = { phase: "plan", runId: "run-plan-3", result };

    const first = await POST(request(body), { params: Promise.resolve({ id: "dec-correct" }) }) as { json: () => Promise<{ data: { decision: unknown } } > };
    const second = await POST(request(body), { params: Promise.resolve({ id: "dec-WRONG" }) }) as { json: () => Promise<{ data: { decision: unknown } } > };

    expect(applyDecisionRunResult).toHaveBeenCalledTimes(2);
    expect(advanceDecisionAfterPhase).toHaveBeenCalledTimes(2);
    // Both calls resolve to the same decision id/result -- one applied result,
    // not two divergent branches -- because both derive it from the same
    // run.json rather than trusting each caller's own (possibly wrong) URL id.
    expect(applyDecisionRunResult.mock.calls[0][0]).toMatchObject({ decisionId: "dec-correct" });
    expect(applyDecisionRunResult.mock.calls[1][0]).toMatchObject({ decisionId: "dec-correct" });
    const firstData = (await first.json()).data;
    const secondData = (await second.json()).data;
    expect(secondData).toEqual(firstData);
  });
});
