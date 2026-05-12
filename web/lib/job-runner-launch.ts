import { spawn, type StdioOptions } from "node:child_process";
import { join } from "node:path";
import config, { nsPath, orgPath } from "@/lib/config";
import { buildChildEnv } from "@/lib/child-env";
import { resolveInternalAuthSecret } from "@/lib/internal-api-auth";
import type { Job } from "@/lib/job-store";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function resolveJobWorkspaceCwd(input: Record<string, unknown> = {}): string | undefined {
  return (
    stringField(input.workspaceCwd) ||
    stringField(input.workspacePath) ||
    stringField(input.workspaceId) ||
    stringField(input.workspace)
  );
}

export function resolveJobRunnerRoots(namespaceId: string, orgId: string) {
  const namespaceRoot = nsPath(namespaceId);
  const orgRoot = orgPath(namespaceId, orgId);

  return {
    namespaceRoot,
    orgRoot,
    // Job files are currently stored at namespace scope by job-store.ts.
    // Keep the runner pointed there while org-scoped data such as profiles
    // and secrets resolves through MENTIKO_ORG_ROOT.
    projectRoot: namespaceRoot,
  };
}

interface LaunchJobRunnerOptions {
  job: Pick<Job, "id" | "input">;
  namespaceId: string;
  orgId: string;
  origin?: string;
  callbackUrl?: string;
  stdio?: StdioOptions;
}

export function launchJobRunner({
  job,
  namespaceId,
  orgId,
  origin,
  callbackUrl,
  stdio,
}: LaunchJobRunnerOptions): void {
  const runnerPath = join(config.codeRoot, "lib", "job-runner.mjs");
  const resolvedCallbackUrl = callbackUrl ?? (origin ? `${origin}/api/jobs/[id]/complete` : undefined);
  const roots = resolveJobRunnerRoots(namespaceId, orgId);

  const child = spawn(process.execPath, [runnerPath, job.id], {
    detached: true,
    stdio: stdio ?? ["ignore", "ignore", "ignore"],
    env: buildChildEnv({
      MENTIKO_GLOBAL_ROOT: config.globalRoot,
      MENTIKO_CODE_ROOT: config.codeRoot,
      MENTIKO_PROJECT_ROOT: roots.projectRoot,
      MENTIKO_ORG_ROOT: roots.orgRoot,
      MENTIKO_NAMESPACE_ROOT: roots.namespaceRoot,
      NAMESPACE_ID: namespaceId,
      ORG_ID: orgId,
      JOB_CALLBACK_URL: resolvedCallbackUrl,
      JOB_CALLBACK_SECRET: resolveInternalAuthSecret("jobs-complete"),
      JOB_WORKSPACE_CWD: resolveJobWorkspaceCwd(job.input),
    }),
  });
  child.unref();
}
