import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export interface ChainVersionMetadata {
  version: string;
  created: string | null;
  message: string;
  author: string;
  [key: string]: unknown;
}

export interface VersionListEntry {
  version: string;
  created: string;
  message: string;
}

export interface VersionRollbackResult {
  currentVersion: string;
  targetVersion: string;
  newVersion: string;
  backupFile: string;
}

type JsonRecord = Record<string, unknown>;

export function parseSemver(version: string): [number, number, number] {
  const normalized = normalizeSemver(version);
  const match = SEMVER.exec(normalized);
  if (!match) throw new Error(`invalid semver: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function formatVersion(major: number, minor: number, patch: number): string {
  for (const value of [major, minor, patch]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid version component: ${value}`);
  }
  return `${major}.${minor}.${patch}`;
}

export function bumpVersion(version: string, increment: string = "patch"): string {
  const [majorValue, minorValue, patchValue] = parseSemver(version);
  switch (increment) {
    case "major":
      return formatVersion(majorValue + 1, 0, 0);
    case "minor":
      return formatVersion(majorValue, minorValue + 1, 0);
    case "patch":
    default:
      return formatVersion(majorValue, minorValue, patchValue + 1);
  }
}

export function versionsDirectory(chainDir: string): string {
  return join(requireNonEmptyPath(chainDir, "chain directory"), "versions");
}

export function versionPath(chainDir: string, version: string): string {
  return join(versionsDirectory(chainDir), `v${normalizeSemver(version)}`, "chain.json");
}

export function versionExists(chainDir: string, version: string): boolean {
  const path = versionPath(chainDir, version);
  return isRegularFile(path);
}

export function nextVersion(chainDir: string, increment: string = "patch"): string {
  const chainFile = join(requireNonEmptyPath(chainDir, "chain directory"), "chain.json");
  if (!isRegularFile(chainFile)) return "1.0.0";

  const document = readJsonObject(chainFile, "chain.json");
  if (typeof document.version !== "string" || !SEMVER.test(document.version)) return "1.0.0";
  return bumpVersion(document.version, increment);
}

export function createVersion(
  chainDir: string,
  version: string,
  message: string = "",
  author = process.env.GIT_AUTHOR_NAME || process.env.USER || "unknown",
  now = new Date(),
): string {
  const normalized = normalizeSemver(version);
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const chainFile = join(root, "chain.json");
  if (!isRegularFile(chainFile)) throw new Error(`chain file not found: ${chainFile}`);

  const rawChain = readFileSync(chainFile);
  const document = parseJsonObject(rawChain.toString("utf8"), "chain.json");
  const versionDir = join(versionsDirectory(root), `v${normalized}`);
  mkdirSync(versionDir, { recursive: true });
  writeFileSync(join(versionDir, "chain.json"), rawChain, { mode: 0o600 });

  const created = now.toISOString();
  const metadata: ChainVersionMetadata = { version: normalized, created, message, author };
  writeJsonAtomic(join(versionDir, "metadata.json"), metadata);

  const changelog = join(root, "CHANGELOG.md");
  if (isRegularFile(changelog)) copyFileSync(changelog, join(versionDir, "CHANGELOG.md"));

  const versions = readVersionHistory(document, "chain.json");
  versions.push({ version: normalized, created, message });
  versions.sort((left, right) => requireString(right.created, "version created").localeCompare(requireString(left.created, "version created")));
  document.versions = versions;
  writeJsonAtomic(chainFile, document);
  return `v${normalized}`;
}

export function listVersions(chainDir: string): VersionListEntry[] {
  const root = versionsDirectory(chainDir);
  if (!isDirectory(root)) return [];

  const entries: VersionListEntry[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith("v") || !entry.isDirectory()) continue;
    const version = normalizeSemver(entry.name.slice(1));
    const metadataPath = join(root, entry.name, "metadata.json");
    let created = "";
    let message = "";
    if (isRegularFile(metadataPath)) {
      const metadata = readJsonObject(metadataPath, `${entry.name}/metadata.json`);
      if (metadata.created !== undefined && metadata.created !== null && typeof metadata.created !== "string") {
        throw new Error(`${entry.name}/metadata.json created must be a string or null`);
      }
      if (metadata.message !== undefined && typeof metadata.message !== "string") {
        throw new Error(`${entry.name}/metadata.json message must be a string`);
      }
      created = typeof metadata.created === "string" ? metadata.created : "";
      message = typeof metadata.message === "string" ? metadata.message : "";
    }
    entries.push({ version, created, message });
  }
  entries.sort((left, right) => compareVersions(right.version, left.version));
  return entries;
}

export function rollback(chainDir: string, targetVersion: string, now = new Date()): VersionRollbackResult {
  const normalizedTarget = normalizeSemver(targetVersion);
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const chainFile = join(root, "chain.json");
  const source = versionPath(root, normalizedTarget);
  if (!isRegularFile(source)) throw new Error(`version not found: v${normalizedTarget}`);
  if (!isRegularFile(chainFile)) throw new Error(`chain file not found: ${chainFile}`);

  const backupDir = join(root, ".rollback-backup");
  mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, `chain.json.${timestampForFilename(now)}`);
  copyFileSync(chainFile, backupFile);
  copyFileSync(source, chainFile);

  const restored = readJsonObject(chainFile, "restored chain.json");
  const currentVersion = requireString(restored.version, "restored chain version");
  const newVersion = nextVersion(root, "patch");
  restored.version = newVersion;
  writeJsonAtomic(chainFile, restored);
  return { currentVersion, targetVersion: normalizedTarget, newVersion, backupFile };
}

export function diffVersions(chainDir: string, fromVersion = "", toVersion = ""): string {
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const chainFile = join(root, "chain.json");
  const resolvedFrom = fromVersion || "current";
  const resolvedTo = toVersion || latestVersion(root) || "";
  const fromPath = resolvedFrom === "current" ? chainFile : versionPath(root, resolvedFrom);
  const toPath = resolvedTo === "current" ? chainFile : versionPath(root, resolvedTo);
  if (!isRegularFile(fromPath)) throw new Error(`version not found: ${resolvedFrom}`);
  if (!isRegularFile(toPath)) throw new Error(`version not found: ${resolvedTo}`);

  const result = spawnSync("diff", ["-u", fromPath, toPath], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(String(result.stderr || `diff exited with status ${result.status}`));
  }
  return `diff: ${resolvedFrom} -> ${resolvedTo}\n---\n${result.stdout || ""}`;
}

export function compareAgents(chainDir: string, fromVersion = "", toVersion = ""): string {
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const fromPath = fromVersion === "current" || !fromVersion
    ? join(root, "chain.json")
    : versionPath(root, fromVersion);
  const toPath = toVersion === "current" || !toVersion
    ? join(root, "chain.json")
    : versionPath(root, toVersion);
  if (!isRegularFile(fromPath) || !isRegularFile(toPath)) throw new Error("cannot find version files");

  const fromAgents = agentPrompts(readJsonObject(fromPath, "from chain.json"));
  const toAgents = agentPrompts(readJsonObject(toPath, "to chain.json"));
  const fromIds = [...fromAgents.keys()].sort();
  const toIds = [...toAgents.keys()].sort();
  const added = toIds.filter((id) => !fromAgents.has(id));
  const removed = fromIds.filter((id) => !toAgents.has(id));
  const common = fromIds.filter((id) => toAgents.has(id));
  const modified = common.filter((id) => {
    const fromHash = createHash("md5").update(fromAgents.get(id) || "").digest("hex");
    const toHash = createHash("md5").update(toAgents.get(id) || "").digest("hex");
    return fromHash !== toHash;
  });

  return [
    "agents added:",
    ...added.map((id) => `  + ${id}`),
    "",
    "agents removed:",
    ...removed.map((id) => `  - ${id}`),
    "",
    "agents modified:",
    ...modified.map((id) => `  ~ ${id}`),
    "",
  ].join("\n");
}

export function validateVersion(version: string): boolean {
  return typeof version === "string" && SEMVER.test(version);
}

export function getMetadata(chainDir: string, version: string): ChainVersionMetadata {
  const normalized = normalizeSemver(version);
  const metadataPath = join(versionsDirectory(chainDir), `v${normalized}`, "metadata.json");
  if (!isRegularFile(metadataPath)) {
    return { version: normalized, created: null, message: "", author: "" };
  }
  const metadata = readJsonObject(metadataPath, `${normalized}/metadata.json`);
  if (metadata.version !== undefined && typeof metadata.version !== "string") {
    throw new Error(`${normalized}/metadata.json version must be a string`);
  }
  if (metadata.created !== undefined && metadata.created !== null && typeof metadata.created !== "string") {
    throw new Error(`${normalized}/metadata.json created must be a string or null`);
  }
  if (metadata.message !== undefined && typeof metadata.message !== "string") {
    throw new Error(`${normalized}/metadata.json message must be a string`);
  }
  if (metadata.author !== undefined && typeof metadata.author !== "string") {
    throw new Error(`${normalized}/metadata.json author must be a string`);
  }
  return {
    ...metadata,
    version: typeof metadata.version === "string" ? metadata.version : normalized,
    created: typeof metadata.created === "string" ? metadata.created : null,
    message: typeof metadata.message === "string" ? metadata.message : "",
    author: typeof metadata.author === "string" ? metadata.author : "",
  };
}

function normalizeSemver(version: string): string {
  if (typeof version !== "string") throw new Error(`invalid semver: ${String(version)}`);
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  if (!SEMVER.test(normalized)) throw new Error(`invalid semver: ${version}`);
  return normalized;
}

function requireNonEmptyPath(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJsonObject(path: string, label: string): JsonRecord {
  return parseJsonObject(readFileSync(path, "utf8"), label);
}

function parseJsonObject(raw: string, label: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object`);
  return parsed as JsonRecord;
}

function readVersionHistory(document: JsonRecord, label: string): JsonRecord[] {
  if (document.versions === undefined || document.versions === null) return [];
  if (!Array.isArray(document.versions)) throw new Error(`${label} versions must be an array`);
  return document.versions.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} versions[${index}] must be an object`);
    const record = entry as JsonRecord;
    if (typeof record.version !== "string" || typeof record.created !== "string" || typeof record.message !== "string") {
      throw new Error(`${label} versions[${index}] has invalid fields`);
    }
    normalizeSemver(record.version);
    return { ...record };
  });
}

function agentPrompts(document: JsonRecord): Map<string, string> {
  if (document.agents === undefined || document.agents === null) return new Map();
  if (!Array.isArray(document.agents)) throw new Error("agents must be an array");
  const result = new Map<string, string>();
  for (const entry of document.agents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as JsonRecord;
    if (typeof record.id !== "string") continue;
    result.set(record.id, typeof record.prompt === "string" ? record.prompt : "");
  }
  return result;
}

function compareVersions(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parseSemver(left);
  const [rightMajor, rightMinor, rightPatch] = parseSemver(right);
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}

function latestVersion(chainDir: string): string | undefined {
  return listVersions(chainDir)[0]?.version;
}

function timestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}
