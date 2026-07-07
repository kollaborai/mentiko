#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);

function usage() {
  console.error("usage: mentiko decision import <artifact.json> --decision <id> --phase <phase> [--run <runId>] [--workspace <path>] [--selected-option <id>]");
  process.exit(2);
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
}

function readRunScopedToken(artifactPath, filename) {
  const resolved = resolve(artifactPath);
  const artifactDir = dirname(resolved);
  const runDir = dirname(artifactDir);
  const tokenPath = join(runDir, ".internal", filename);
  if (basename(artifactDir) !== "artifacts" || !existsSync(tokenPath)) {
    return "";
  }
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

async function main() {
  const command = args[0] || "";
  if (command !== "import") usage();

  const artifactPath = args[1] || "";
  if (!artifactPath || !existsSync(artifactPath)) {
    console.error(`artifact not found: ${artifactPath || "(missing)"}`);
    process.exit(1);
  }

  const decisionId = readFlag("--decision") || process.env.MENTIKO_DECISION_ID || "";
  const phase = readFlag("--phase") || process.env.MENTIKO_DECISION_PHASE || "";
  const runId = readFlag("--run") || process.env.MENTIKO_RUN_ID || process.env.RUN_ID || "";
  const workspacePath = readFlag("--workspace") || process.env.MENTIKO_DECISION_WORKSPACE_PATH || "";
  const selectedOptionId = readFlag("--selected-option") || process.env.MENTIKO_DECISION_SELECTED_OPTION_ID || "";
  if (!decisionId || !phase) usage();

  let result;
  try {
    result = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    console.error(`invalid decision artifact json: ${error.message}`);
    process.exit(1);
  }

  const baseUrl = process.env.MENTIKO_WEB_URL || `http://localhost:${process.env.WEB_PORT || process.env.PORT || 3000}`;
  const token =
    process.env.MENTIKO_DECISION_IMPORT_TOKEN ||
    readRunScopedToken(artifactPath, "decision-import-token") ||
    process.env.BETTER_AUTH_SECRET ||
    "";
  const response = await fetch(`${baseUrl}/api/decisions/${encodeURIComponent(decisionId)}/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-namespace-id": process.env.NAMESPACE_ID || "default",
      "x-org-id": process.env.ORG_ID || "default",
    },
    body: JSON.stringify({
      phase,
      runId,
      workspacePath: workspacePath || undefined,
      selectedOptionId: selectedOptionId || undefined,
      result,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(`decision import failed: ${response.status} ${text}`);
    process.exit(1);
  }

  console.log(`decision import complete: ${decisionId} ${phase}${runId ? ` ${runId}` : ""}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
