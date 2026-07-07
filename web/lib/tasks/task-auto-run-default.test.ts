/**
 * @jest-environment node
 */

const readSystemSettings = jest.fn();
const getWorkspace = jest.fn();
const resolveAutoRun = jest.fn();

jest.mock("@/lib/system/system-settings", () => ({
  readSystemSettings: (...args: unknown[]) => readSystemSettings(...args),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  resolveAutoRun: (...args: unknown[]) => resolveAutoRun(...args),
}));

import { resolveTaskAutoRunDefault } from "./task-auto-run-default";

describe("resolveTaskAutoRunDefault", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readSystemSettings.mockReturnValue({ auto_run_enabled: true });
    getWorkspace.mockReturnValue({ path: "/repo", auto_run: "inherit" });
    resolveAutoRun.mockReturnValue(true);
  });

  it("uses explicit false as an opt-out", () => {
    expect(resolveTaskAutoRunDefault({
      namespaceId: "ns",
      orgId: "default",
      workspacePath: "/repo",
      explicitAutoRun: false,
    })).toBe(false);
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it("uses the workspace/system default when not explicitly set", () => {
    expect(resolveTaskAutoRunDefault({
      namespaceId: "ns",
      orgId: "default",
      workspacePath: "/repo",
    })).toBe(true);
    expect(getWorkspace).toHaveBeenCalledWith("ns", "default", "/repo");
    expect(readSystemSettings).toHaveBeenCalledWith("ns");
    expect(resolveAutoRun).toHaveBeenCalledWith({ path: "/repo", auto_run: "inherit" }, true);
  });

  it("defaults off when no workspace is scoped", () => {
    expect(resolveTaskAutoRunDefault({
      namespaceId: "ns",
      orgId: "default",
    })).toBe(false);
  });
});
