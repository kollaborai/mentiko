import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import path from "path";
import { orgPath } from "@/lib/config";
import { runGit } from "@/lib/git/exec";
import { BadRequest, Conflict, InternalServerError } from "@/lib/api-errors";
import {
  addWorkspace,
  listWorkspaces,
  slugify,
  type Workspace,
} from "@/lib/workspaces/workspace-storage";

export interface GitHubImportInput {
  namespaceId: string;
  orgId: string;
  name: string;
  gitUrl: string;
  branch?: string;
}

export interface GitHubImportResult {
  workspace: Workspace;
  reused: boolean;
}

const GITHUB_REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/;

export function validateGitHubImportUrl(value: string): string {
  const url = String(value).trim();
  if (!GITHUB_REPOSITORY.test(url)) {
    throw new BadRequest("Only GitHub HTTPS repositories are supported");
  }
  return url;
}

export function validateGitHubBranch(value: string | undefined): string {
  const branch = String(value || "main").trim();
  if (!BRANCH.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.includes("@{")) {
    throw new BadRequest("Invalid branch name", { field: "branch" });
  }
  return branch;
}

/** Clone a public/private GitHub repository into the org-owned workspace root. */
export function importGitHubWorkspace(input: GitHubImportInput): GitHubImportResult {
  const name = String(input.name || "").trim();
  if (!name || name.length > 100) throw new BadRequest("Workspace name is required");
  const gitUrl = validateGitHubImportUrl(input.gitUrl);
  const branch = validateGitHubBranch(input.branch);
  const id = slugify(name);
  if (!id) throw new BadRequest("Workspace name must contain letters or numbers");

  const existing = listWorkspaces(input.namespaceId, input.orgId).find((workspace) =>
    workspace.id === id
  );
  if (existing) {
    if (existing.project?.gitUrl === gitUrl && existing.project.branch === branch) {
      return { workspace: existing, reused: true };
    }
    throw new Conflict("Workspace already exists", { workspaceId: id });
  }

  const root = orgPath(input.namespaceId, input.orgId, "workspaces");
  const target = path.join(root, id);
  mkdirSync(root, { recursive: true });
  if (existsSync(target)) throw new Conflict("Workspace already exists", { workspaceId: id });

  try {
    runGit(root, ["clone", "--depth", "1", "--branch", branch, "--", gitUrl, target], {
      timeout: 120000,
    });
    const entries = readdirSync(target);
    if (entries.length === 0 || !existsSync(path.join(target, ".git"))) {
      throw new Error("clone produced an invalid repository");
    }
    const workspace: Workspace = {
      id,
      name,
      path: target,
      addedAt: new Date().toISOString(),
      project: { gitUrl, branch },
      execution: { type: "local" },
    };
    addWorkspace(input.namespaceId, input.orgId, workspace);
    return { workspace, reused: false };
  } catch (error) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (error instanceof BadRequest || error instanceof Conflict) throw error;
    const message = error instanceof Error ? error.message : "GitHub repository import failed";
    throw new InternalServerError(message);
  }
}
