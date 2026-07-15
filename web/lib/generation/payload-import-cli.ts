#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeResultForKind, resolveGenerationPayload } from "@/lib/generation/payload-resolver";

export { normalizeResultForKind, resolveGenerationPayload } from "@/lib/generation/payload-resolver";

export async function runGenerationPayloadImportCli(argv: string[], environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (argv[0] !== "import") throw new Error("usage: generation import <artifact.json> --job <id> --kind <kind> [--run <runId>]");
  const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : "";
  const values = flags(positional ? argv.slice(2) : argv.slice(1));
  const jobId = values.get("--job") || environment.MENTIKO_GENERATION_JOB_ID || "";
  const kind = values.get("--kind") || environment.MENTIKO_GENERATION_KIND || "";
  const runId = values.get("--run") || environment.MENTIKO_RUN_ID || environment.RUN_ID || "";
  if (!jobId || !kind) throw new Error("generation import requires --job and --kind.");
  const artifactsDir = environment.ARTIFACTS_DIR || "";
  const payload = resolveGenerationPayload(positional, artifactsDir, kind, environment.MENTIKO_COMPLETION_EVENT_DATA ?? "");
  if (!payload) throw new Error("No valid generation payload was found in this run's artifact, event, transcript, or output sources.");
  const token = environment.MENTIKO_JOB_IMPORT_TOKEN || readRunScopedToken(positional || join(artifactsDir, "generation-result.json"), "generation-import-token") || environment.BETTER_AUTH_SECRET || "";
  const baseUrl = environment.MENTIKO_WEB_URL || `http://localhost:${environment.WEB_PORT || environment.PORT || 3000}`;
  const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-namespace-id": environment.NAMESPACE_ID || "default", "x-org-id": environment.ORG_ID || "default" },
    body: JSON.stringify({ status: "complete", result: normalizeResultForKind(payload.result, kind), runId: runId || undefined, generationKind: kind }),
  });
  if (!response.ok) throw new Error(`generation import failed: ${response.status} ${await response.text().catch(() => "")}`);
}

function flags(argv: string[]): Map<string, string> { const values = new Map<string, string>(); for (let index = 0; index < argv.length; index += 2) { const key = argv[index]; const value = argv[index + 1]; if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("Invalid generation import arguments."); values.set(key, value); } return values; }
function readRunScopedToken(artifactPath: string, filename: string): string { const artifactDir = dirname(resolve(artifactPath)); const path = join(dirname(artifactDir), ".internal", filename); if (basename(artifactDir) !== "artifacts" || !existsSync(path)) return ""; try { return readFileSync(path, "utf8").trim(); } catch { return ""; } }
if (require.main === module) runGenerationPayloadImportCli(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
