#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/runner-v2/version-control-cli.ts
var version_control_cli_exports = {};
__export(version_control_cli_exports, {
  runVersionControlCli: () => runVersionControlCli
});
module.exports = __toCommonJS(version_control_cli_exports);

// lib/runner-v2/version-control.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
function parseSemver(version) {
  const normalized = normalizeSemver(version);
  const match = SEMVER.exec(normalized);
  if (!match) throw new Error(`invalid semver: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function formatVersion(major, minor, patch) {
  for (const value of [major, minor, patch]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid version component: ${value}`);
  }
  return `${major}.${minor}.${patch}`;
}
function bumpVersion(version, increment = "patch") {
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
function versionsDirectory(chainDir) {
  return (0, import_node_path.join)(requireNonEmptyPath(chainDir, "chain directory"), "versions");
}
function versionPath(chainDir, version) {
  return (0, import_node_path.join)(versionsDirectory(chainDir), `v${normalizeSemver(version)}`, "chain.json");
}
function versionExists(chainDir, version) {
  const path = versionPath(chainDir, version);
  return isRegularFile(path);
}
function nextVersion(chainDir, increment = "patch") {
  const chainFile = (0, import_node_path.join)(requireNonEmptyPath(chainDir, "chain directory"), "chain.json");
  if (!isRegularFile(chainFile)) return "1.0.0";
  const document = readJsonObject(chainFile, "chain.json");
  if (typeof document.version !== "string" || !SEMVER.test(document.version)) return "1.0.0";
  return bumpVersion(document.version, increment);
}
function createVersion(chainDir, version, message = "", author = process.env.GIT_AUTHOR_NAME || process.env.USER || "unknown", now = /* @__PURE__ */ new Date()) {
  const normalized = normalizeSemver(version);
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const chainFile = (0, import_node_path.join)(root, "chain.json");
  if (!isRegularFile(chainFile)) throw new Error(`chain file not found: ${chainFile}`);
  const rawChain = (0, import_node_fs.readFileSync)(chainFile);
  const document = parseJsonObject(rawChain.toString("utf8"), "chain.json");
  const versionDir = (0, import_node_path.join)(versionsDirectory(root), `v${normalized}`);
  (0, import_node_fs.mkdirSync)(versionDir, { recursive: true });
  (0, import_node_fs.writeFileSync)((0, import_node_path.join)(versionDir, "chain.json"), rawChain, { mode: 384 });
  const created = now.toISOString();
  const metadata = { version: normalized, created, message, author };
  writeJsonAtomic((0, import_node_path.join)(versionDir, "metadata.json"), metadata);
  const changelog = (0, import_node_path.join)(root, "CHANGELOG.md");
  if (isRegularFile(changelog)) (0, import_node_fs.copyFileSync)(changelog, (0, import_node_path.join)(versionDir, "CHANGELOG.md"));
  const versions = readVersionHistory(document, "chain.json");
  versions.push({ version: normalized, created, message });
  versions.sort((left, right) => requireString(right.created, "version created").localeCompare(requireString(left.created, "version created")));
  document.versions = versions;
  writeJsonAtomic(chainFile, document);
  return `v${normalized}`;
}
function listVersions(chainDir) {
  const root = versionsDirectory(chainDir);
  if (!isDirectory(root)) return [];
  const entries = [];
  for (const entry of (0, import_node_fs.readdirSync)(root, { withFileTypes: true })) {
    if (!entry.name.startsWith("v") || !entry.isDirectory()) continue;
    const version = normalizeSemver(entry.name.slice(1));
    const metadataPath = (0, import_node_path.join)(root, entry.name, "metadata.json");
    let created = "";
    let message = "";
    if (isRegularFile(metadataPath)) {
      const metadata = readJsonObject(metadataPath, `${entry.name}/metadata.json`);
      if (metadata.created !== void 0 && metadata.created !== null && typeof metadata.created !== "string") {
        throw new Error(`${entry.name}/metadata.json created must be a string or null`);
      }
      if (metadata.message !== void 0 && typeof metadata.message !== "string") {
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
function rollback(chainDir, targetVersion, now = /* @__PURE__ */ new Date()) {
  const normalizedTarget = normalizeSemver(targetVersion);
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const chainFile = (0, import_node_path.join)(root, "chain.json");
  const source = versionPath(root, normalizedTarget);
  if (!isRegularFile(source)) throw new Error(`version not found: v${normalizedTarget}`);
  if (!isRegularFile(chainFile)) throw new Error(`chain file not found: ${chainFile}`);
  const backupDir = (0, import_node_path.join)(root, ".rollback-backup");
  (0, import_node_fs.mkdirSync)(backupDir, { recursive: true });
  const backupFile = (0, import_node_path.join)(backupDir, `chain.json.${timestampForFilename(now)}`);
  (0, import_node_fs.copyFileSync)(chainFile, backupFile);
  (0, import_node_fs.copyFileSync)(source, chainFile);
  const restored = readJsonObject(chainFile, "restored chain.json");
  const currentVersion = requireString(restored.version, "restored chain version");
  const newVersion = nextVersion(root, "patch");
  restored.version = newVersion;
  writeJsonAtomic(chainFile, restored);
  return { currentVersion, targetVersion: normalizedTarget, newVersion, backupFile };
}
function diffVersions(chainDir, fromVersion = "", toVersion = "") {
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const chainFile = (0, import_node_path.join)(root, "chain.json");
  const resolvedFrom = fromVersion || "current";
  const resolvedTo = toVersion || latestVersion(root) || "";
  const fromPath = resolvedFrom === "current" ? chainFile : versionPath(root, resolvedFrom);
  const toPath = resolvedTo === "current" ? chainFile : versionPath(root, resolvedTo);
  if (!isRegularFile(fromPath)) throw new Error(`version not found: ${resolvedFrom}`);
  if (!isRegularFile(toPath)) throw new Error(`version not found: ${resolvedTo}`);
  const result = (0, import_node_child_process.spawnSync)("diff", ["-u", fromPath, toPath], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(String(result.stderr || `diff exited with status ${result.status}`));
  }
  return `diff: ${resolvedFrom} -> ${resolvedTo}
---
${result.stdout || ""}`;
}
function compareAgents(chainDir, fromVersion = "", toVersion = "") {
  const root = requireNonEmptyPath(chainDir, "chain directory");
  const fromPath = fromVersion === "current" || !fromVersion ? (0, import_node_path.join)(root, "chain.json") : versionPath(root, fromVersion);
  const toPath = toVersion === "current" || !toVersion ? (0, import_node_path.join)(root, "chain.json") : versionPath(root, toVersion);
  if (!isRegularFile(fromPath) || !isRegularFile(toPath)) throw new Error("cannot find version files");
  const fromAgents = agentPrompts(readJsonObject(fromPath, "from chain.json"));
  const toAgents = agentPrompts(readJsonObject(toPath, "to chain.json"));
  const fromIds = [...fromAgents.keys()].sort();
  const toIds = [...toAgents.keys()].sort();
  const added = toIds.filter((id) => !fromAgents.has(id));
  const removed = fromIds.filter((id) => !toAgents.has(id));
  const common = fromIds.filter((id) => toAgents.has(id));
  const modified = common.filter((id) => {
    const fromHash = (0, import_node_crypto.createHash)("md5").update(fromAgents.get(id) || "").digest("hex");
    const toHash = (0, import_node_crypto.createHash)("md5").update(toAgents.get(id) || "").digest("hex");
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
    ""
  ].join("\n");
}
function validateVersion(version) {
  return typeof version === "string" && SEMVER.test(version);
}
function getMetadata(chainDir, version) {
  const normalized = normalizeSemver(version);
  const metadataPath = (0, import_node_path.join)(versionsDirectory(chainDir), `v${normalized}`, "metadata.json");
  if (!isRegularFile(metadataPath)) {
    return { version: normalized, created: null, message: "", author: "" };
  }
  const metadata = readJsonObject(metadataPath, `${normalized}/metadata.json`);
  if (metadata.version !== void 0 && typeof metadata.version !== "string") {
    throw new Error(`${normalized}/metadata.json version must be a string`);
  }
  if (metadata.created !== void 0 && metadata.created !== null && typeof metadata.created !== "string") {
    throw new Error(`${normalized}/metadata.json created must be a string or null`);
  }
  if (metadata.message !== void 0 && typeof metadata.message !== "string") {
    throw new Error(`${normalized}/metadata.json message must be a string`);
  }
  if (metadata.author !== void 0 && typeof metadata.author !== "string") {
    throw new Error(`${normalized}/metadata.json author must be a string`);
  }
  return {
    ...metadata,
    version: typeof metadata.version === "string" ? metadata.version : normalized,
    created: typeof metadata.created === "string" ? metadata.created : null,
    message: typeof metadata.message === "string" ? metadata.message : "",
    author: typeof metadata.author === "string" ? metadata.author : ""
  };
}
function normalizeSemver(version) {
  if (typeof version !== "string") throw new Error(`invalid semver: ${String(version)}`);
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  if (!SEMVER.test(normalized)) throw new Error(`invalid semver: ${version}`);
  return normalized;
}
function requireNonEmptyPath(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}
function requireString(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function isRegularFile(path) {
  try {
    return (0, import_node_fs.lstatSync)(path).isFile();
  } catch {
    return false;
  }
}
function isDirectory(path) {
  try {
    return (0, import_node_fs.lstatSync)(path).isDirectory();
  } catch {
    return false;
  }
}
function readJsonObject(path, label) {
  return parseJsonObject((0, import_node_fs.readFileSync)(path, "utf8"), label);
}
function parseJsonObject(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object`);
  return parsed;
}
function readVersionHistory(document, label) {
  if (document.versions === void 0 || document.versions === null) return [];
  if (!Array.isArray(document.versions)) throw new Error(`${label} versions must be an array`);
  return document.versions.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} versions[${index}] must be an object`);
    const record = entry;
    if (typeof record.version !== "string" || typeof record.created !== "string" || typeof record.message !== "string") {
      throw new Error(`${label} versions[${index}] has invalid fields`);
    }
    normalizeSemver(record.version);
    return { ...record };
  });
}
function agentPrompts(document) {
  if (document.agents === void 0 || document.agents === null) return /* @__PURE__ */ new Map();
  if (!Array.isArray(document.agents)) throw new Error("agents must be an array");
  const result = /* @__PURE__ */ new Map();
  for (const entry of document.agents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry;
    if (typeof record.id !== "string") continue;
    result.set(record.id, typeof record.prompt === "string" ? record.prompt : "");
  }
  return result;
}
function compareVersions(left, right) {
  const [leftMajor, leftMinor, leftPatch] = parseSemver(left);
  const [rightMajor, rightMinor, rightPatch] = parseSemver(right);
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}
function latestVersion(chainDir) {
  return listVersions(chainDir)[0]?.version;
}
function timestampForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${(0, import_node_crypto.randomUUID)()}.tmp`;
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
  try {
    (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(value, null, 2)}
`, { flag: "wx", mode: 384 });
    (0, import_node_fs.renameSync)(temporary, path);
  } finally {
    if ((0, import_node_fs.existsSync)(temporary)) (0, import_node_fs.rmSync)(temporary, { force: true });
  }
}

// lib/runner-v2/version-control-cli.ts
function runVersionControlCli(argv, write = (value) => process.stdout.write(value)) {
  const [command, ...args] = argv;
  switch (command) {
    case "parse-semver": {
      requireArgCount(args, 1, command);
      write(`${parseSemver(args[0]).join(" ")}
`);
      return;
    }
    case "format-version": {
      requireArgCount(args, 3, command);
      write(`${formatVersion(safeInteger(args[0]), safeInteger(args[1]), safeInteger(args[2]))}
`);
      return;
    }
    case "bump-version": {
      if (args.length < 1 || args.length > 2) throw usage(command);
      write(`${bumpVersion(args[0], args[1])}
`);
      return;
    }
    case "next-version": {
      if (args.length < 1 || args.length > 2) throw usage(command);
      write(`${nextVersion(args[0], args[1])}
`);
      return;
    }
    case "versions-dir": {
      requireArgCount(args, 1, command);
      write(`${versionsDirectory(args[0])}
`);
      return;
    }
    case "version-path": {
      requireArgCount(args, 2, command);
      write(`${versionPath(args[0], args[1])}
`);
      return;
    }
    case "version-exists": {
      requireArgCount(args, 2, command);
      if (!versionExists(args[0], args[1])) process.exitCode = 1;
      return;
    }
    case "create-version": {
      if (args.length < 2 || args.length > 3) throw usage(command);
      write(`${createVersion(args[0], args[1], args[2] ?? "")}
`);
      return;
    }
    case "list-versions": {
      requireArgCount(args, 1, command);
      const lines = listVersions(args[0]).map((entry) => `${entry.version}|${entry.created}|${entry.message}`);
      if (lines.length > 0) write(`${lines.join("\n")}
`);
      return;
    }
    case "rollback": {
      requireArgCount(args, 2, command);
      const result = rollback(args[0], args[1]);
      write(`backed up current to: ${result.backupFile}
`);
      write(`rolled back from v${result.currentVersion} to v${result.targetVersion} (saved as v${result.newVersion})
`);
      write(`backup at: ${result.backupFile}
`);
      return;
    }
    case "diff": {
      if (args.length < 1 || args.length > 3) throw usage(command);
      write(`${diffVersions(args[0], args[1] ?? "", args[2] ?? "")}
`);
      return;
    }
    case "compare-agents": {
      if (args.length < 1 || args.length > 3) throw usage(command);
      write(`${compareAgents(args[0], args[1] ?? "", args[2] ?? "")}`);
      return;
    }
    case "validate-version": {
      requireArgCount(args, 1, command);
      if (!validateVersion(args[0])) process.exitCode = 1;
      return;
    }
    case "metadata": {
      requireArgCount(args, 2, command);
      write(`${JSON.stringify(getMetadata(args[0], args[1]))}
`);
      return;
    }
    default:
      throw usage(command);
  }
}
function requireArgCount(args, count, command) {
  if (args.length !== count) throw usage(command);
}
function safeInteger(value) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`invalid integer: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`integer is out of range: ${value}`);
  return parsed;
}
function usage(command) {
  return new Error(`usage: runner-version-control ${command || "<command>"}`);
}
if (require.main === module) {
  try {
    runVersionControlCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runVersionControlCli
});
