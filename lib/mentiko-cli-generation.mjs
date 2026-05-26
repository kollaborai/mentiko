#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);

function usage() {
  console.error("usage: mentiko generation import <artifact.json> --job <id> --kind <kind> [--run <runId>]");
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

  const jobId = readFlag("--job") || process.env.MENTIKO_GENERATION_JOB_ID || "";
  const kind = readFlag("--kind") || process.env.MENTIKO_GENERATION_KIND || "";
  const runId = readFlag("--run") || process.env.MENTIKO_RUN_ID || process.env.RUN_ID || "";
  if (!jobId || !kind) usage();

  let result;
  try {
    result = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    console.error(`invalid generation artifact json: ${error.message}`);
    process.exit(1);
  }

  const baseUrl = process.env.MENTIKO_WEB_URL || `http://localhost:${process.env.WEB_PORT || 3000}`;
  const token =
    process.env.MENTIKO_JOB_IMPORT_TOKEN ||
    readRunScopedToken(artifactPath, "generation-import-token") ||
    process.env.BETTER_AUTH_SECRET ||
    "";
  const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-namespace-id": process.env.NAMESPACE_ID || "default",
      "x-org-id": process.env.ORG_ID || "default",
    },
    body: JSON.stringify({
      status: "complete",
      result,
      runId: runId || undefined,
      generationKind: kind,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(`generation import failed: ${response.status} ${text}`);
    process.exit(1);
  }

  console.log(`generation import complete: ${jobId} ${kind}${runId ? ` ${runId}` : ""}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
