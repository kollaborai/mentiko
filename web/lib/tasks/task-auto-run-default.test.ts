/**
 * @jest-environment node
 */

const readSystemSettings = jest.fn();
const getWorkspace = jest.fn();
const listWorkspaces = jest.fn();
const resolveAutoRun = jest.fn();

jest.mock("@/lib/system/system-settings", () => ({
  readSystemSettings: (...args: unknown[]) => readSystemSettings(...args),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
  resolveAutoRun: (...args: unknown[]) => resolveAutoRun(...args),
}));

import { resolveTaskAutoRunDefault } from "./task-auto-run-default";

describe("resolveTaskAutoRunDefault", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readSystemSettings.mockReturnValue({ auto_run_enabled: true });
    getWorkspace.mockReturnValue({ path: "/repo", auto_run: "inherit" });
    listWorkspaces.mockReturnValue([]);
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

  it("falls back to matching by workspace path when getWorkspace only matches by id (B1)", () => {
    // real-world shape: workspacePath here is a filesystem path
    // (tasks.workspace_id / ?workspace= both store paths), which never
    // matches a Workspace.id slug -- getWorkspace() correctly misses.
    getWorkspace.mockReturnValue(null);
    listWorkspaces.mockReturnValue([
      { id: "acme-web", path: "/repo", name: "Acme Web", auto_run: "inherit" },
    ]);

    expect(resolveTaskAutoRunDefault({
      namespaceId: "ns",
      orgId: "default",
      workspacePath: "/repo",
    })).toBe(true);
    expect(getWorkspace).toHaveBeenCalledWith("ns", "default", "/repo");
    expect(listWorkspaces).toHaveBeenCalledWith("ns", "default");
    expect(resolveAutoRun).toHaveBeenCalledWith(
      { id: "acme-web", path: "/repo", name: "Acme Web", auto_run: "inherit" },
      true,
    );
  });

  it("defaults off when neither id nor path lookup finds the workspace", () => {
    getWorkspace.mockReturnValue(null);
    listWorkspaces.mockReturnValue([]);

    expect(resolveTaskAutoRunDefault({
      namespaceId: "ns",
      orgId: "default",
      workspacePath: "/missing",
    })).toBe(false);
    expect(resolveAutoRun).not.toHaveBeenCalled();
  });
});
