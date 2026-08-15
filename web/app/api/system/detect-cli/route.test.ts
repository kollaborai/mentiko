jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/agents/agent-provider-catalog", () => ({
  getDetectableCliTools: () => [{ id: "claude" }],
  getCliBinary: () => "claude",
}));

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

import { execSync } from "child_process";
import { GET } from "./route";
import { resetCliDetectionCacheForTests } from "@/lib/system/cli-detection-cache";

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

function request(): Parameters<typeof GET>[0] {
  return new Request("http://localhost:3000/api/system/detect-cli") as Parameters<typeof GET>[0];
}

describe("GET /api/system/detect-cli", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCliDetectionCacheForTests();
  });

  it("never boots a second Claude CLI while an agent is live", async () => {
    mockExecSync.mockImplementation((command) => {
      if (command === "ps -eo comm=,stat=") return "claude Sl+\n";
      if (command === "which claude") return "/usr/local/bin/claude\n";
      throw new Error(`unexpected command: ${String(command)}`);
    });

    const response = await GET(request());
    await expect(response.json()).resolves.toMatchObject({
      data: { tools: [{ name: "claude", found: true, path: "/usr/local/bin/claude" }] },
    });
    expect(mockExecSync).not.toHaveBeenCalledWith(
      expect.stringMatching(/^claude /),
      expect.anything(),
    );
  });

  it("collapses repeated idle detection into one cached probe", async () => {
    mockExecSync.mockImplementation((command) => {
      if (command === "ps -eo comm=,stat=") return "next-server Ssl\n";
      if (command === "which claude") return "/usr/local/bin/claude\n";
      if (command === "claude --version") return "2.1.0 (Claude Code)\n";
      if (command === "claude auth status") return '{"loggedIn":true}\n';
      throw new Error(`unexpected command: ${String(command)}`);
    });

    const first = await GET(request());
    const second = await GET(request());
    await expect(first.json()).resolves.toMatchObject({
      data: { tools: [{ name: "claude", found: true, version: "2.1.0 (Claude Code)", authenticated: true }] },
    });
    await expect(second.json()).resolves.toMatchObject({
      data: { tools: [{ name: "claude", authenticated: true }] },
    });
    expect(mockExecSync).toHaveBeenCalledTimes(4);
  });
});
