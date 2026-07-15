#!/usr/bin/env node

import Ajv from "ajv";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const APPLY = process.argv.includes("--apply");
const namespaceId = option("--namespace") || "default";
const globalRoot = process.env.MENTIKO_GLOBAL_ROOT
  || process.env.MENTIKO_ROOT
  || join(homedir(), ".mentiko");
const namespaceRoot = join(globalRoot, "namespaces", namespaceId);
const runsDir = join(namespaceRoot, "runs");
const jobsDir = join(namespaceRoot, "jobs");
const quarantineRoot = join(
  namespaceRoot,
  "quarantine",
  "data-shape-repair-2026-07-14",
  "test-runs",
);
const draftBackupSuffix = ".pre-schema-gate-2026-07-14";

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validateRun = ajv.compile(readSchema("run.schema.json"));
const validateTask = ajv.compile(readSchema("task.schema.json"));

function option(name) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function requiredCount(name) {
  const raw = option(name);
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(`${name}=<count> is required with --apply`);
  }
  return Number(raw);
}

function readSchema(name) {
  return JSON.parse(readFileSync(join(REPO_ROOT, "lib", "schemas", name), "utf8"));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => join(path, entry.name));
}

function files(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => join(path, entry.name));
}

function hasJobReference(runId) {
  return files(jobsDir)
    .filter((path) => path.endsWith(".json"))
    .some((path) => {
      try {
        return readJson(path).runId === runId;
      } catch {
        return false;
      }
    });
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isLeakedTestRun(runDir, value) {
  const runId = basename(runDir);
  const entries = readdirSync(runDir).sort();
  if (entries.length !== 1 || entries[0] !== "run.json") return false;
  if (value?.id !== runId || value?.chainId !== "chain-recommendation") return false;
  if (hasJobReference(runId)) return false;

  if (runId.startsWith("run-blocked-") && value.status === "blocked") {
    return exactKeys(value, ["chainId", "id", "status", "status_message", "taskId"]);
  }
  if (runId.startsWith("run-stopped-list-") && value.status === "stopped") {
    return exactKeys(value, ["chainId", "id", "status"]);
  }
  return false;
}

function normalizeText(value) {
  if (!Array.isArray(value)) return value;
  if (!value.every((item) => typeof item === "string")) return value;
  return value.join("\n");
}

function normalizeTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = structuredClone(value);
  normalized.acceptance_criteria = normalizeText(normalized.acceptance_criteria);
  if (Array.isArray(normalized.subtasks) && normalized.subtasks.length > 0) {
    normalized.type = "epic";
    normalized.subtasks = normalized.subtasks.map((subtask) => {
      if (!subtask || typeof subtask !== "object" || Array.isArray(subtask)) return subtask;
      return {
        ...subtask,
        acceptance_criteria: normalizeText(subtask.acceptance_criteria),
      };
    });
  }
  return normalized;
}

function scan() {
  const invalidRuns = [];
  const invalidTasks = [];

  for (const runDir of directories(runsDir)) {
    const runPath = join(runDir, "run.json");
    if (existsSync(runPath)) {
      try {
        const value = readJson(runPath);
        if (!validateRun(value)) {
          invalidRuns.push({
            runDir,
            repairable: isLeakedTestRun(runDir, value),
          });
        }
      } catch {
        invalidRuns.push({ runDir, repairable: false });
      }
    }

    const draftPath = join(runDir, "artifacts", "draft-child-tasks.json");
    if (!existsSync(draftPath)) continue;
    try {
      const value = readJson(draftPath);
      if (!validateTask(value)) {
        const normalized = normalizeTask(value);
        invalidTasks.push({
          path: draftPath,
          normalized,
          repairable: Boolean(validateTask(normalized)),
        });
      }
    } catch {
      invalidTasks.push({ path: draftPath, normalized: undefined, repairable: false });
    }
  }

  return { invalidRuns, invalidTasks };
}

function ensureBackup(path) {
  const backupPath = `${path}${draftBackupSuffix}`;
  if (existsSync(backupPath)) {
    if (readFileSync(backupPath).equals(readFileSync(path))) return backupPath;
    throw new Error("existing draft backup does not match the current artifact");
  }
  copyFileSync(path, backupPath, constants.COPYFILE_EXCL);
  return backupPath;
}

function writeJsonAtomic(path, value) {
  const tempPath = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

function assertRepairable(snapshot, expectedRuns, expectedTasks) {
  if (snapshot.invalidRuns.length !== expectedRuns || snapshot.invalidTasks.length !== expectedTasks) {
    throw new Error(
      `refusing repair: expected ${expectedRuns} invalid runs and ${expectedTasks} invalid tasks, found ${snapshot.invalidRuns.length} and ${snapshot.invalidTasks.length}`,
    );
  }
  if (snapshot.invalidRuns.some((item) => !item.repairable)) {
    throw new Error("refusing repair: at least one invalid run is not an exact leaked test fixture");
  }
  if (snapshot.invalidTasks.some((item) => !item.repairable)) {
    throw new Error("refusing repair: at least one invalid task cannot be normalized to task.schema.json");
  }
  for (const item of snapshot.invalidRuns) {
    if (existsSync(join(quarantineRoot, basename(item.runDir)))) {
      throw new Error("refusing repair: a quarantine target already exists");
    }
  }
  for (const item of snapshot.invalidTasks) {
    const backupPath = `${item.path}${draftBackupSuffix}`;
    if (existsSync(backupPath) && !readFileSync(backupPath).equals(readFileSync(item.path))) {
      throw new Error("refusing repair: an existing draft backup does not match its artifact");
    }
  }
}

const before = scan();

if (!APPLY) {
  console.log(JSON.stringify({
    mode: "dry-run",
    invalidRuns: before.invalidRuns.length,
    repairableRuns: before.invalidRuns.filter((item) => item.repairable).length,
    invalidTasks: before.invalidTasks.length,
    repairableTasks: before.invalidTasks.filter((item) => item.repairable).length,
  }, null, 2));
  process.exit(0);
}

const expectedRuns = requiredCount("--expect-runs");
const expectedTasks = requiredCount("--expect-tasks");
assertRepairable(before, expectedRuns, expectedTasks);
mkdirSync(quarantineRoot, { recursive: true });

for (const item of before.invalidTasks) {
  ensureBackup(item.path);
  writeJsonAtomic(item.path, item.normalized);
}

for (const item of before.invalidRuns) {
  const target = join(quarantineRoot, basename(item.runDir));
  renameSync(item.runDir, target);
}

const after = scan();
if (after.invalidRuns.length || after.invalidTasks.length) {
  throw new Error(
    `repair verification failed: ${after.invalidRuns.length} invalid runs and ${after.invalidTasks.length} invalid tasks remain`,
  );
}

console.log(JSON.stringify({
  mode: "applied",
  quarantinedTestRuns: before.invalidRuns.length,
  normalizedTaskDrafts: before.invalidTasks.length,
  draftBackups: before.invalidTasks.length,
  invalidRunsAfter: after.invalidRuns.length,
  invalidTasksAfter: after.invalidTasks.length,
}, null, 2));
