#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { buildBundle, normalizeForCompare } from "../scripts/build-runner-bundles.mjs";

const root = new URL("..", import.meta.url).pathname;
const shell = readFileSync(join(root, "lib", "git-integration.sh"), "utf8");
const source = readFileSync(join(root, "web", "lib", "runner-v2", "git-integration-cli.ts"), "utf8");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

assert.match(shell, /runner-git-integration\.js/);
assert.match(shell, /MENTIKO_CODE_ROOT:\?/);
const functionSection = (name, nextName) => {
  const start = shell.indexOf(`${name}()`);
  assert.notEqual(start, -1, `${name} must remain exported`);
  const end = nextName ? shell.indexOf(`${nextName}()`, start + name.length + 2) : shell.length;
  return shell.slice(start, end === -1 ? shell.length : end);
};
for (const [name, nextName] of [
  ["git_status", "git_commit_chain"],
  ["git_get_history", "git_diff_commits"],
  ["git_diff_commits", "git_get_file_at_commit"],
  ["git_list_branches", "git_switch_branch"],
  ["git_detect_conflicts", "git_resolve_conflict"],
  ["git_get_commit_info", "git_compare_branches"],
  ["git_compare_branches", "git_get_stash_list"],
  ["git_get_stash_list", "git_get_repo_dir"],
]) {
  assert.doesNotMatch(functionSection(name, nextName), /\bjq\b|\bwhile\b|\bfor\b|JSON\.parse/);
  assert.match(functionSection(name, nextName), /_git_integration_cli/);
}
assert.match(source, /readGitStatus|readGitHistory|readGitDiff|readGitBranches|readGitConflicts|readGitCommitInfo|readGitBranchComparison|readGitStashList/);
assert.match(dockerfile, /git-integration-cli\.ts/);
assert.match(dockerfile, /runner-git-integration\.js/);

const temp = mkdtempSync(join(tmpdir(), "mentiko-git-bundle-parity-"));
try {
  const output = join(temp, "runner-git-integration.js");
  // Use the shared builder, not a second hand-written esbuild invocation. This test
  // used to duplicate the command and omitted --banner:js, so once the committed
  // bundles gained their GENERATED banner it reported "stale" forever — a sibling of
  // the central parity check that drifted the moment the build flags changed.
  // normalizeForCompare additionally ignores WHERE node_modules resolved.
  buildBundle("git-integration-cli", output);
  assert.equal(
    normalizeForCompare(readFileSync(output, "utf8")),
    normalizeForCompare(readFileSync(join(root, "lib", "runner-git-integration.js"), "utf8")),
    "typed git bundle is stale — run: node scripts/build-runner-bundles.mjs",
  );
  console.log("PASS: git integration shell boundary and bundle parity");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
