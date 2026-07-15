import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { canonicalizeRunsDir, requireRunId } from "@/lib/runs/run-record";

export interface RunspaceManifest {
  run_id: string;
  chain: string;
  artifacts: unknown[];
}

export interface EnsureRunspaceManifestResult {
  manifestPath: string;
  created: boolean;
  manifest: RunspaceManifest;
}

/**
 * Own the small per-run manifest used to introduce agents to their shared
 * artifact directory. This is deliberately create-only: later artifact state
 * needs its own typed operation rather than an unbounded JSON patch escape hatch.
 */
export function ensureRunspaceManifest(
  runsDir: string,
  runId: string,
  chain: string,
): EnsureRunspaceManifestResult {
  const canonicalRunsDir = canonicalizeRunsDir(runsDir);
  const canonicalRunId = requireRunId(runId);
  if (typeof chain !== "string" || chain.trim() === "") throw new Error("Runspace manifest chain is required.");

  const runDir = containedDirectory(canonicalRunsDir, canonicalRunId, "Run directory");
  const runspaceDir = containedDirectory(runDir, "runspace", "Runspace directory");
  const manifestPath = join(runspaceDir, "manifest.json");
  const expected: RunspaceManifest = { run_id: canonicalRunId, chain, artifacts: [] };

  try {
    writeFileSync(manifestPath, `${JSON.stringify(expected)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { manifestPath, created: true, manifest: expected };
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return { manifestPath, created: false, manifest: readExistingManifest(manifestPath, expected) };
  }
}

function containedDirectory(parent: string, child: string, label: string): string {
  const path = join(parent, child);
  if (relative(parent, path).startsWith("..")) throw new Error(`${label} escapes configured root.`);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a non-symbolic directory.`);
  } else {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  return resolve(path);
}

function readExistingManifest(path: string, expected: RunspaceManifest): RunspaceManifest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Runspace manifest is not valid JSON: ${path}`);
  }
  if (!isRunspaceManifest(value)) throw new Error(`Runspace manifest has an invalid shape: ${path}`);
  if (value.run_id !== expected.run_id || value.chain !== expected.chain) {
    throw new Error(`Runspace manifest identity mismatch: ${path}`);
  }
  return value;
}

function isRunspaceManifest(value: unknown): value is RunspaceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.run_id === "string"
    && typeof record.chain === "string"
    && Array.isArray(record.artifacts);
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && (error as NodeJS.ErrnoException).code === "EEXIST";
}
