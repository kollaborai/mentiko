#!/usr/bin/env node
// GENERATED FROM web/lib/runner-v2/audit-ship-cli.ts - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs
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

// lib/runner-v2/audit-ship-cli.ts
var audit_ship_cli_exports = {};
__export(audit_ship_cli_exports, {
  runAuditShipCli: () => runAuditShipCli
});
module.exports = __toCommonJS(audit_ship_cli_exports);

// lib/runner-v2/audit-ship.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var BACKOFF_DELAYS_MS = [1e3, 5e3, 15e3];
var MAX_ATTEMPTS = 3;
function stringValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
function parseRawAuditJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("audit ship received an empty JSONL entry");
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`audit ship received invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function validateRawAuditEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("audit ship entry must be a JSON object");
  }
  return value;
}
function normalizeAuditEntry(value) {
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("audit ship entry id is required");
  if (typeof value.timestamp !== "string" || !value.timestamp.trim()) throw new Error("audit ship entry timestamp is required");
  if (Number.isNaN(Date.parse(value.timestamp))) throw new Error("audit ship entry timestamp is invalid");
  return value;
}
function parseAuditEntry(raw) {
  return normalizeAuditEntry(validateRawAuditEntry(parseRawAuditJson(raw)));
}
function deriveEpochMs(entry, now, random) {
  const ts = stringValue(entry.timestamp);
  const secondFloor = (d) => Math.floor(d.getTime() / 1e3) * 1e3;
  if (!ts) return secondFloor(now()) + Math.floor(random() * 1e3);
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return secondFloor(now());
  return Math.floor(parsed / 1e3) * 1e3;
}
function deriveShortId(entry) {
  const id = stringValue(entry.id) || "unknown";
  const afterUnderscore = id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : id;
  return afterUnderscore.slice(0, 8);
}
function deriveDatePartition(entry, now) {
  const ts = stringValue(entry.timestamp);
  let datePart = ts ? ts.split("T")[0] : "";
  if (!datePart) {
    const d = now();
    const pad = (n) => String(n).padStart(2, "0");
    datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return { year: datePart.slice(0, 4), month: datePart.slice(5, 7), day: datePart.slice(8, 10) };
}
function parseS3Url(remoteUrl) {
  const stripped = remoteUrl.startsWith("s3://") ? remoteUrl.slice(5) : remoteUrl;
  const slashIndex = stripped.indexOf("/");
  const bucket = slashIndex === -1 ? stripped : stripped.slice(0, slashIndex);
  if (!bucket) return null;
  let prefix = "";
  if (slashIndex !== -1) {
    prefix = stripped.slice(slashIndex + 1).replace(/\/$/, "");
  }
  return { bucket, prefix };
}
function resolveAuditTarget(entry, env, now, random) {
  const configuredUrl = stringValue(env.AUDIT_REMOTE_URL);
  if (!configuredUrl) return { status: "disabled" };
  const namespaceId = stringValue(env.NAMESPACE_ID);
  const remoteUrl = configuredUrl.replaceAll("{NAMESPACE_ID}", namespaceId);
  const parsed = parseS3Url(remoteUrl);
  if (!parsed) return { status: "malformed", url: remoteUrl };
  const epochMs = deriveEpochMs(entry, now, random);
  const shortId = deriveShortId(entry);
  const { year, month, day } = deriveDatePartition(entry, now);
  const dateKey = `${year}/${month}/${day}/audit-${epochMs}-${shortId}.json`;
  const remoteKey = parsed.prefix ? `${parsed.prefix}/${dateKey}` : `${namespaceId}/${dateKey}`;
  return { status: "ok", bucket: parsed.bucket, remoteKey, entryId: stringValue(entry.id) || "unknown", remoteUrl, epochMs };
}
function buildFailureEntry(record) {
  return JSON.stringify({
    failed_at: record.failedAt,
    entry_id: record.entryId,
    remote_key: record.remoteKey,
    remote_url: record.remoteUrl,
    attempts: record.attempts
  });
}
function buildRcloneInvocation(sourcePath, target, env) {
  const args = [
    "copyto",
    sourcePath,
    `:s3:${target.bucket}/${target.remoteKey}`,
    "--s3-provider=Other",
    `--s3-endpoint=${stringValue(env.AUDIT_S3_ENDPOINT)}`,
    "--s3-env-auth=false",
    "--quiet"
  ];
  const spawnEnv = {
    ...env,
    RCLONE_S3_ACCESS_KEY_ID: stringValue(env.AUDIT_REMOTE_ACCESS_KEY),
    RCLONE_S3_SECRET_ACCESS_KEY: stringValue(env.AUDIT_REMOTE_SECRET_KEY)
  };
  return { args, spawnEnv };
}
function defaultSpawnRclone(cwd) {
  return (command, args, env) => new Promise((resolve) => {
    const child = (0, import_node_child_process.spawn)(command, args, { stdio: ["ignore", "ignore", "ignore"], env, cwd });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
function isoSecondUtc(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function resolveFailureLog(env) {
  const namespaceRoot = stringValue(env.NAMESPACE_ROOT);
  return (0, import_node_path.join)(env.AUDIT_DIR ? stringValue(env.AUDIT_DIR) : namespaceRoot ? `${namespaceRoot}/audit` : "audit", "ship-failures.log");
}
async function shipAuditEntry(entryLine, deps = {}) {
  const env = deps.env ?? process.env;
  if (!entryLine.trim() || !env.AUDIT_REMOTE_URL) return 0;
  const now = deps.now ?? (() => /* @__PURE__ */ new Date());
  const random = deps.random ?? Math.random;
  let entry;
  try {
    entry = parseAuditEntry(entryLine);
  } catch (error) {
    (deps.stderr ?? ((line) => process.stderr.write(`${line}
`)))(`warn: audit ship rejected raw entry: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  const target = resolveAuditTarget(entry, env, now, random);
  if (target.status === "disabled") return 0;
  if (target.status === "malformed") {
    (deps.stderr ?? ((line) => process.stderr.write(`${line}
`)))(
      `warn: AUDIT_REMOTE_URL malformed, cannot derive bucket: ${target.url}`
    );
    return 0;
  }
  const mkdtemp = deps.mkdtemp ?? ((prefix) => (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_os.tmpdir)(), prefix)));
  const writeFile = deps.writeFile ?? ((path, data) => (0, import_node_fs.writeFileSync)(path, data));
  const removeFile = deps.removeFile ?? ((path) => (0, import_node_fs.rmSync)(path, { recursive: true, force: true }));
  const stderr = deps.stderr ?? ((line) => process.stderr.write(`${line}
`));
  const tempDir = mkdtemp("audit-ship-");
  const tempEntry = (0, import_node_path.join)(tempDir, "entry.json");
  try {
    writeFile(tempEntry, entryLine.endsWith("\n") ? entryLine : `${entryLine}
`);
    const { args, spawnEnv } = buildRcloneInvocation(tempEntry, target, env);
    const spawnRclone = deps.spawnRclone ?? defaultSpawnRclone(tempDir);
    const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const code = await spawnRclone("rclone", args, spawnEnv);
      if (code === 0) return 0;
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_DELAYS_MS[attempt - 1]);
    }
  } finally {
    try {
      removeFile(tempDir);
    } catch (error) {
      stderr(`warn: audit ship cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const failureLog = resolveFailureLog(env);
  const failureLine = buildFailureEntry({
    failedAt: isoSecondUtc(now()),
    entryId: target.entryId,
    remoteKey: target.remoteKey,
    remoteUrl: target.remoteUrl,
    attempts: MAX_ATTEMPTS
  });
  const appendFile = deps.appendFile ?? ((path, data) => {
    (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
    (0, import_node_fs.appendFileSync)(path, data);
  });
  try {
    appendFile(failureLog, `${failureLine}
`);
  } catch (error) {
    stderr(`warn: audit ship failure breadcrumb could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
  stderr(`warn: audit ship failed after ${MAX_ATTEMPTS} attempts`);
  stderr(`  entry_id: ${target.entryId}`);
  stderr(`  remote_key: ${target.remoteKey}`);
  stderr(`  remote_url: ${target.remoteUrl}`);
  stderr(`  logged to: ${failureLog}`);
  return 0;
}
function parseFlags(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === void 0 || values.has(flag)) {
      throw new Error("Invalid runner audit-ship argument list.");
    }
    values.set(flag, value);
  }
  return values;
}
async function runAuditShipCli(argv) {
  const command = argv[0];
  if (command !== "ship") {
    throw new Error("usage: runner-audit-ship ship  (reads one JSONL audit entry from stdin)");
  }
  const flags = parseFlags(argv.slice(1));
  if (flags.size) throw new Error("runner-audit-ship ship takes no flags.");
  const entryLine = await readStdin();
  return shipAuditEntry(entryLine);
}
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
if (require.main === module) {
  runAuditShipCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner audit-ship failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 0;
  });
}

// lib/runner-v2/audit-ship-cli.ts
if (require.main === module) {
  runAuditShipCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner audit-ship failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 0;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runAuditShipCli
});
