import { BadRequest, Conflict } from "@/lib/api-errors";
import { validateGitHubImportUrl, validateGitHubBranch, importGitHubWorkspace } from "./github-import";

jest.mock("@/lib/git/exec", () => ({ runGit: jest.fn() }));
jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: jest.fn(() => []),
  addWorkspace: jest.fn(),
  slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
}));
jest.mock("fs", () => ({
  existsSync: jest.fn((value: string) => value.endsWith("/.git")),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(() => [".git"]),
  rmSync: jest.fn(),
}));

describe("github workspace import", () => {
  it("accepts only canonical GitHub HTTPS repository URLs", () => {
    expect(validateGitHubImportUrl("https://github.com/acme/project.git")).toContain("github.com");
    expect(() => validateGitHubImportUrl("https://evil.example/acme/project")).toThrow(BadRequest);
    expect(() => validateGitHubImportUrl("https://github.com/acme/project/../secret")).toThrow(BadRequest);
  });

  it("rejects unsafe branch names", () => {
    expect(validateGitHubBranch("feature/demo")).toBe("feature/demo");
    expect(() => validateGitHubBranch("../main")).toThrow(BadRequest);
    expect(() => validateGitHubBranch("main@{bad}")).toThrow(BadRequest);
  });

  it("is idempotent for an existing matching workspace", () => {
    const storage = require("@/lib/workspaces/workspace-storage");
    const existing = { id: "demo", name: "Demo", path: "/tmp/demo", addedAt: "now", project: { gitUrl: "https://github.com/acme/demo", branch: "main" } };
    storage.listWorkspaces.mockReturnValue([existing]);
    expect(importGitHubWorkspace({ namespaceId: "n", orgId: "o", name: "Demo", gitUrl: existing.project.gitUrl })).toEqual({ workspace: existing, reused: true });
    storage.listWorkspaces.mockReturnValue([]);
  });

  it("rejects conflicting workspace IDs", () => {
    const storage = require("@/lib/workspaces/workspace-storage");
    storage.listWorkspaces.mockReturnValue([{ id: "demo", project: { gitUrl: "other", branch: "main" } }]);
    expect(() => importGitHubWorkspace({ namespaceId: "n", orgId: "o", name: "Demo", gitUrl: "https://github.com/acme/demo" })).toThrow(Conflict);
    storage.listWorkspaces.mockReturnValue([]);
  });
});
