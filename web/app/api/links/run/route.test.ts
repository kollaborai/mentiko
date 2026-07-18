import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "peer-link-route-"));

jest.mock("@/lib/config", () => ({ __esModule: true, default: { codeRoot: "/code" }, orgPath: (...parts: string[]) => join(root, ...parts) }));
jest.mock("@/lib/pty/pty-client", () => ({ pty: { spawn: jest.fn().mockResolvedValue({ name: "link-test" }) } }));
jest.mock("@/lib/namespace-config", () => ({ getNamespaceIdFromRequest: async () => "default", getOrgIdFromRequest: async () => "default" }));
jest.mock("@/lib/auth/rbac-auth", () => ({ requirePermission: async () => undefined }));
jest.mock("@/lib/auth/auth-bridge", () => ({ getSessionUser: async () => ({ id: "user" }) }));
jest.mock("@/lib/auth/workspace-auth", () => ({ resolveAuthorizedWorkspacePath: () => "/workspace" }));
jest.mock("@/lib/links/link-utils", () => ({
  loadLink: jest.fn(() => ({ id: "link", name: "Typed Link", config: { max_rounds: 2 }, agents: { agent1: {}, agent2: {} } })),
  resolveLinkAgentName: (_agent: unknown, _namespace: string, _org: string) => "agent",
}));
jest.mock("@/lib/api-response", () => ({ withErrorHandling: (handler: unknown) => handler, apiSuccess: (value: unknown) => value }));
jest.mock("@/lib/links/link-run-runtime", () => ({
  normalizeLinkId: (value: unknown) => typeof value === "string" ? value : null,
  resolveLinkRunPaths: (_namespace: string, _org: string, runId: string) => ({ runsDir: join(root, "runs"), runDir: join(root, "runs", runId) }),
  resolveLinkRunSecret: () => "secret",
  buildLinkRunEnv: () => ({ MENTIKO_NAMESPACE_ROOT: join(root, "namespace") }),
}));

import { POST } from "@/app/api/links/run/route";
const { pty } = jest.requireMock("@/lib/pty/pty-client") as { pty: { spawn: jest.Mock } };
const { loadLink } = jest.requireMock("@/lib/links/link-utils") as { loadLink: jest.Mock };

describe("POST /api/links/run", () => {
  it("starts the compiled typed peer controller directly in the manager PTY", async () => {
    const response = await POST({ json: async () => ({ linkId: "link", workspaceId: "workspace" }) } as never);
    expect(response).toMatchObject({ status: "launching" });
    expect(pty.spawn).toHaveBeenCalledWith(expect.stringMatching(/^link-/), "node", [
      "/code/lib/runner-peer-link-controller.js", "--context", expect.stringContaining("peer-link-controller.json"),
    ], expect.objectContaining({ cwd: "/workspace" }));
    const runDir = join(root, "runs");
    const run = require("node:fs").readdirSync(runDir)[0];
    const context = JSON.parse(readFileSync(join(runDir, run, ".internal", "peer-link-controller.json"), "utf8"));
    expect(context).toMatchObject({ task: "Typed Link", workspacePath: "/workspace" });
    expect(existsSync(join(runDir, run, "run.json"))).toBe(true);
  });

  it("preserves an explicit legacy unlimited max_rounds value in typed controller context", async () => {
    loadLink.mockReturnValueOnce({ id: "link", name: "Unlimited Link", config: { max_rounds: 0 }, agents: { agent1: {}, agent2: {} } });
    await POST({ json: async () => ({ linkId: "link" }) } as never);
    const runDir = join(root, "runs");
    const runs = require("node:fs").readdirSync(runDir).sort();
    const context = JSON.parse(readFileSync(join(runDir, runs[runs.length - 1], ".internal", "peer-link-controller.json"), "utf8"));
    expect(context.maxRounds).toBe(0);
  });
});
