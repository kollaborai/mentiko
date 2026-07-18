#!/usr/bin/env node
"use strict";

// lib/runner-v2/job-worker.ts
var import_node_fs3 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_os = require("node:os");
var import_node_crypto2 = require("node:crypto");

// ../lib/ai-gateway-agent-env.mjs
var import_node_fs = require("node:fs");
var import_node_url = require("node:url");
var import_meta = {};
var PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "FEATHERLESS_API_KEY",
  "GLM_TOKEN"
];
var LOCAL_PROXY_CONTROL_KEYS = [
  "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED",
  "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL",
  "MENTIKO_AI_GATEWAY_LOCAL_TOKEN"
];
function profileHasProviderCredential(profileEnv2 = {}) {
  return PROVIDER_ENV_KEYS.some((key) => Boolean(profileEnv2[key]));
}
function stripInheritedProviderCredentials(childEnv2, profileEnv2) {
  for (const key of PROVIDER_ENV_KEYS) {
    if (!profileEnv2[key]) {
      delete childEnv2[key];
    }
  }
}
function stripLocalProxyControlEnv(childEnv2) {
  for (const key of LOCAL_PROXY_CONTROL_KEYS) {
    delete childEnv2[key];
  }
}
function applyLocalAiGatewayProxyEnv(childEnv2, profileEnv2, sourceEnv) {
  if (sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED !== "true") return;
  if (profileHasProviderCredential(profileEnv2)) return;
  const baseUrl = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_BASE_URL;
  const token = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_TOKEN;
  if (!baseUrl || !token) return;
  if (!profileEnv2.OPENAI_BASE_URL) childEnv2.OPENAI_BASE_URL = baseUrl;
  if (!profileEnv2.OPENAI_API_BASE) childEnv2.OPENAI_API_BASE = baseUrl;
  if (!profileEnv2.OPENAI_API_KEY) childEnv2.OPENAI_API_KEY = token;
  childEnv2.MENTIKO_AI_GATEWAY_PROXY = "local";
}
function buildAiGatewayAgentEnv(baseEnv = {}, profileEnv2 = {}, sourceEnv = process.env) {
  const childEnv2 = { ...baseEnv, ...profileEnv2 };
  delete childEnv2.CLAUDECODE;
  stripInheritedProviderCredentials(childEnv2, profileEnv2);
  stripLocalProxyControlEnv(childEnv2);
  applyLocalAiGatewayProxyEnv(childEnv2, profileEnv2, sourceEnv);
  return childEnv2;
}
function readProfileEnv(profileFile) {
  if (!profileFile) return {};
  let raw;
  try {
    raw = (0, import_node_fs.readFileSync)(profileFile, "utf8");
  } catch {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const env = parsed && typeof parsed === "object" ? parsed.env : void 0;
  return env && typeof env === "object" ? env : {};
}
function linesHaveProviderCredential(lines) {
  if (!lines) return false;
  for (const line of String(lines).split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (value && PROVIDER_ENV_KEYS.includes(key)) return true;
  }
  return false;
}
function localProxyEnvLines(profileEnv2, existingGatewayEnv, workspaceType, sourceEnv = process.env) {
  if ((workspaceType || "local") !== "local") return [];
  if (sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED !== "true") return [];
  const baseUrl = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_BASE_URL;
  const token = sourceEnv.MENTIKO_AI_GATEWAY_LOCAL_TOKEN;
  if (!baseUrl || !token) return [];
  if (profileHasProviderCredential(profileEnv2)) return [];
  if (linesHaveProviderCredential(existingGatewayEnv)) return [];
  return [
    `OPENAI_BASE_URL=${baseUrl}`,
    `OPENAI_API_BASE=${baseUrl}`,
    `OPENAI_API_KEY=${token}`,
    "MENTIKO_AI_GATEWAY_PROXY=local"
  ];
}
function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      values[token.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return values;
}
function runAiGatewayAgentEnvCli(argv, sourceEnv = process.env) {
  const [command, ...rest] = argv;
  const args = parseCliArgs(rest);
  switch (command) {
    case "profile-has-provider-credential": {
      const env = readProfileEnv(args["profile-file"]);
      return { code: profileHasProviderCredential(env) ? 0 : 1, stdout: "" };
    }
    case "local-proxy-env-lines": {
      const env = readProfileEnv(args["profile-file"]);
      const lines = localProxyEnvLines(env, args["existing-gateway-env"] ?? "", args["workspace-type"] ?? "local", sourceEnv);
      return { code: 0, stdout: lines.length ? `${lines.join("\n")}
` : "" };
    }
    default:
      return { code: 2, stdout: "", stderr: `unknown command: ${command ?? ""}` };
  }
}
if (process.argv[1] && (0, import_node_url.fileURLToPath)(import_meta.url) === process.argv[1]) {
  const result = runAiGatewayAgentEnvCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(`${result.stderr}
`);
  process.exit(result.code);
}

// ../lib/job-runner-output-parser.mjs
function cleanAiOutput(output) {
  return String(output || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}
function extractJsonCandidates(text) {
  const candidates = [];
  const source = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}
function parseAiJsonOutput(output) {
  const cleaned = cleanAiOutput(output);
  try {
    return JSON.parse(cleaned);
  } catch {
    for (const candidate of extractJsonCandidates(cleaned).reverse()) {
      try {
        return JSON.parse(candidate);
      } catch {
      }
    }
  }
  return null;
}

// lib/runner-v2/agent-profile-args.ts
function normalizePermissionFlag(cli, permissionFlag) {
  if (cli === "claude" && permissionFlag === "--dangerously-skip-permissions") {
    return "--allow-dangerously-skip-permissions --permission-mode bypassPermissions";
  }
  return permissionFlag;
}
function resolveProfilePermissionArgs(cli, permissionFlag) {
  const normalized = normalizePermissionFlag(cli, permissionFlag);
  return normalized ? splitProfileArgumentString(normalized, "permission_flag") : [];
}
function splitProfileArgumentString(value, field) {
  const tokens = [];
  let token = "";
  let quote;
  let escaped = false;
  let started = false;
  for (const character of value) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = void 0;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }
  if (escaped || quote) throw new Error(`Invalid ${field}: unterminated escape or quote`);
  if (started) tokens.push(token);
  return tokens;
}

// lib/runs/job-record.ts
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
var JOB_TYPES = ["recommend", "generate", "link", "task", "agent", "artifact", "decision_research", "decision_steering", "decision_retrospective", "decision_guided_questions", "decision_guided_options", "decision_guided_plan", "preference_synthesis", "agent_edit", "webhook_inbound", "webhook_outbound", "event_trigger", "template_test", "link_summary", "task_run_summary"];
var JOB_STATUSES = ["pending", "running", "complete", "failed"];
var JobRecordValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "JobRecordValidationError";
  }
};
function requireJobId(value) {
  if (typeof value !== "string" || !JOB_ID_PATTERN.test(value)) throw new JobRecordValidationError("Invalid job id.");
  return value;
}
function resolveJobRecordPaths(jobsDir, jobId2) {
  if (!(0, import_node_path.isAbsolute)(jobsDir)) throw new JobRecordValidationError("Configured jobs root must be absolute.");
  const id = requireJobId(jobId2);
  (0, import_node_fs2.mkdirSync)(jobsDir, { recursive: true });
  const root = (0, import_node_path.resolve)(jobsDir);
  const jobPath2 = (0, import_node_path.resolve)(root, `${id}.json`);
  if ((0, import_node_path.relative)(root, jobPath2) !== `${id}.json` || (0, import_node_path.dirname)(jobPath2) !== root) throw new JobRecordValidationError("Job path escapes configured root.");
  return { jobsDir: root, jobPath: jobPath2 };
}
function parseJobRecord(content) {
  if (!content.trim()) throw new JobRecordValidationError("Job record must not be empty.");
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new JobRecordValidationError("Job record is not valid JSON.");
  }
  assertJobRecord(value);
  return value;
}
function assertJobRecord(value) {
  if (!isRecord(value)) throw new JobRecordValidationError("Job record must be a JSON object.");
  requireJobId(requiredString(value.id, "id"));
  if (!JOB_TYPES.includes(String(value.type))) throw new JobRecordValidationError("Invalid job type.");
  if (!JOB_STATUSES.includes(String(value.status))) throw new JobRecordValidationError("Invalid job status.");
  if (!isRecord(value.input)) throw new JobRecordValidationError("Job input must be a JSON object.");
  requireTimestamp(requiredString(value.createdAt, "createdAt"), "createdAt");
  for (const key of ["taskId", "decisionId", "runId", "chainId", "createdBy", "error"]) {
    if (value[key] !== void 0 && typeof value[key] !== "string") throw new JobRecordValidationError(`Job ${key} must be a string.`);
  }
  for (const key of ["startedAt", "completedAt"]) if (value[key] !== void 0) requireTimestamp(value[key], key);
  if (value.result !== void 0 && !isRecord(value.result)) throw new JobRecordValidationError("Job result must be a JSON object.");
  if (value.activity !== void 0) {
    if (!Array.isArray(value.activity)) throw new JobRecordValidationError("Job activity must be an array.");
    for (const entry of value.activity) {
      if (!isRecord(entry) || typeof entry.msg !== "string") throw new JobRecordValidationError("Invalid job activity entry.");
      requireTimestamp(entry.time, "activity.time");
    }
  }
  if (value.status === "pending" && (value.startedAt !== void 0 || value.completedAt !== void 0)) {
    throw new JobRecordValidationError("Pending job cannot have lifecycle timestamps.");
  }
  if (value.status === "running" && value.startedAt === void 0) throw new JobRecordValidationError("Running job requires startedAt.");
  if ((value.status === "complete" || value.status === "failed") && value.completedAt === void 0) {
    throw new JobRecordValidationError("Terminal job requires completedAt.");
  }
  if (value.status === "complete" && value.error !== void 0) throw new JobRecordValidationError("Completed job cannot carry an error.");
  if (value.status === "failed" && (typeof value.error !== "string" || !value.error.trim())) throw new JobRecordValidationError("Failed job requires an error.");
}
function writeJobRecord(jobsDir, record) {
  assertJobRecord(record);
  const { jobPath: jobPath2 } = resolveJobRecordPaths(jobsDir, record.id);
  writeAtomic(jobPath2, record);
  return record;
}
function writeAtomic(path, value) {
  (0, import_node_fs2.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
  const temporary = (0, import_node_path.join)((0, import_node_path.dirname)(path), `.${(0, import_node_path.basename)(path)}.${process.pid}.${(0, import_node_crypto.randomBytes)(4).toString("hex")}.tmp`);
  (0, import_node_fs2.writeFileSync)(temporary, `${JSON.stringify(value, null, 2)}
`, { encoding: "utf8", flag: "wx", mode: 384 });
  (0, import_node_fs2.renameSync)(temporary, path);
}
function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new JobRecordValidationError(`Job ${field} must be a non-empty string.`);
  return value;
}
function requireTimestamp(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new JobRecordValidationError(`Job ${field} must be an ISO timestamp.`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// lib/runner-v2/job-worker.ts
var import_node_child_process = require("node:child_process");
var MENTIKO_GLOBAL_ROOT = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || (0, import_node_path2.join)((0, import_node_os.homedir)(), ".mentiko");
var NAMESPACE_ID = process.env.NAMESPACE_ID || "default";
var NAMESPACE_ROOT = (0, import_node_path2.join)(MENTIKO_GLOBAL_ROOT, "namespaces", NAMESPACE_ID);
var ORG_ID = process.env.ORG_ID || "default";
var ORG_ROOT = process.env.MENTIKO_ORG_ROOT || (ORG_ID === "default" ? NAMESPACE_ROOT : (0, import_node_path2.join)(NAMESPACE_ROOT, "orgs", ORG_ID));
var PROJECT_ROOT = process.env.MENTIKO_PROJECT_ROOT || ORG_ROOT;
var JOBS_DIR = (0, import_node_path2.join)(process.env.MENTIKO_NAMESPACE_ROOT || NAMESPACE_ROOT, "jobs");
var AGENT_PROFILES_DIR = (0, import_node_path2.join)(ORG_ROOT, "agent-profiles");
var SECRETS_DIR = (0, import_node_path2.join)(ORG_ROOT, "secrets");
var RUNNER_CHILD_TIMEOUT_MS = 48e4;
var KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
var KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";
var KEY_DERIVATION_ITERATIONS = 1e5;
var KEY_LENGTH_BYTES = 32;
function getVaultSecret() {
  const direct = process.env.VAULT_ENCRYPTION_KEY;
  if (direct) return direct;
  const fallback = process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY;
  if (fallback) return fallback;
  throw new Error("BETTER_AUTH_SECRET is required to decrypt job secrets");
}
function getLegacyVaultSecret() {
  return process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY || getVaultSecret();
}
function deriveVaultAppSecret(rootSecret) {
  const prk = (0, import_node_crypto2.createHmac)("sha256", "\0".repeat(32)).update(rootSecret).digest();
  return (0, import_node_crypto2.createHmac)("sha256", prk).update(`${KEY_DERIVATION_LABEL}`).digest("hex");
}
function getDerivedKey() {
  const appSecret = deriveVaultAppSecret(deriveVaultAppSecret(getVaultSecret()));
  return (0, import_node_crypto2.pbkdf2Sync)(
    appSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}
function getLegacyDerivedKey() {
  const rawSecret = getLegacyVaultSecret();
  return (0, import_node_crypto2.pbkdf2Sync)(
    rawSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}
function getKeyId(key) {
  return (0, import_node_crypto2.createHash)("sha256").update(key).digest("hex").slice(0, 16);
}
function decrypt(ciphertext) {
  try {
    if (ciphertext.startsWith("v1:")) {
      const parts2 = ciphertext.split(":", 5);
      if (parts2.length !== 5) return null;
      const [, keyIdStored, ivHex2, tagHex2, encHex2] = parts2;
      const key = getDerivedKey();
      const keyId = getKeyId(key);
      if (keyIdStored !== keyId) {
        return null;
      }
      const decipher = (0, import_node_crypto2.createDecipheriv)("aes-256-gcm", key, Buffer.from(ivHex2, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex2, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(encHex2, "hex")), decipher.final()]).toString("utf8");
    }
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encHex] = parts;
    const primaryKey = getDerivedKey();
    const fallbackKeys = [primaryKey];
    const legacyKey = getLegacyDerivedKey();
    if (!primaryKey.equals(legacyKey)) {
      fallbackKeys.push(legacyKey);
    }
    for (const candidate of fallbackKeys) {
      try {
        const decipher = (0, import_node_crypto2.createDecipheriv)("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
      } catch {
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}
function getSecretByName(name) {
  if (!(0, import_node_fs3.existsSync)(SECRETS_DIR)) return null;
  for (const f of (0, import_node_fs3.readdirSync)(SECRETS_DIR).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse((0, import_node_fs3.readFileSync)((0, import_node_path2.join)(SECRETS_DIR, f), "utf8"));
      if (rec.name === name && rec.encryptedValue) {
        const val = decrypt(rec.encryptedValue);
        if (!val) {
          console.error(`[secrets] decryption failed: ${rec.id} \u2014 key mismatch or corrupt`);
        }
        return val;
      }
    } catch (err) {
      console.error(`[secrets] error reading secret: ${f}`);
    }
  }
  return null;
}
var SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;
function resolveProfileEnvVars(profileEnv2) {
  const result = {};
  for (const [key, value] of Object.entries(profileEnv2)) {
    const match = value.match(SECRET_REF_PATTERN);
    if (match) {
      const secretName = match[1];
      const secretValue = getSecretByName(secretName);
      if (secretValue !== null) {
        result[key] = secretValue;
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}
function defaultPipeArgsForCli(cli) {
  const bin = String(cli || "").split(/[\\/]/).pop();
  return bin === "agy" || bin === "antigravity" ? [] : ["-p"];
}
function isKollabCli(cli) {
  const bin = String(cli || "").split(/[\\/]/).pop();
  return bin === "kollab";
}
function getArgValue(args, flag) {
  for (let idx = 0; idx < args.length; idx++) {
    const value = String(args[idx]);
    if (value === flag) return args[idx + 1] ? String(args[idx + 1]) : "";
    if (value.startsWith(`${flag}=`)) return value.slice(flag.length + 1);
  }
  return "";
}
function describeCliLaunch(cli, args) {
  const details = [];
  const kollabProfile = isKollabCli(cli) ? getArgValue(args, "--profile") : "";
  const model = getArgValue(args, "--model");
  if (kollabProfile) details.push(`profile ${kollabProfile}`);
  if (model) details.push(`model ${model}`);
  return details.length ? `spawning ${cli} (${details.join(", ")})` : `spawning ${cli}`;
}
var TASK_TYPES = /* @__PURE__ */ new Set(["epic", "feature", "task", "bug", "chore"]);
var SUBTASK_TYPES = /* @__PURE__ */ new Set(["feature", "task", "bug", "chore"]);
function normalizeTextOrArrayField(value, fieldPath) {
  if (value === void 0 || value === null) return { value: void 0 };
  if (typeof value === "string") return { value };
  if (Array.isArray(value)) {
    const invalidAt = value.findIndex((item) => typeof item !== "string");
    if (invalidAt !== -1) {
      return { error: `${fieldPath}[${invalidAt}] must be a string` };
    }
    return { value: value.join("\n") };
  }
  return { error: `${fieldPath} must be a string` };
}
function validateGeneratedTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return { error: "Generated task must be a JSON object" };
  }
  const error = validateTaskFields(task, "task", TASK_TYPES);
  if (error) return { error };
  if (task.design === void 0 && task.design_notes !== void 0) {
    task.design = task.design_notes;
    delete task.design_notes;
  }
  const design = normalizeTextOrArrayField(task.design, "task.design");
  if (design.error) return { error: design.error };
  if (design.value !== void 0) task.design = design.value;
  if (task.labels !== void 0) {
    const labelsError = validateStringArray(task.labels, "task.labels");
    if (labelsError) return { error: labelsError };
  }
  if (task.subtasks !== void 0) {
    if (!Array.isArray(task.subtasks)) {
      return { error: "task.subtasks must be an array" };
    }
    if (task.subtasks.length > 0 && task.type !== "epic") {
      return { error: "Task with subtasks must use type 'epic'" };
    }
    for (let i = 0; i < task.subtasks.length; i++) {
      const subtask = task.subtasks[i];
      if (!subtask || typeof subtask !== "object" || Array.isArray(subtask)) {
        return { error: `task.subtasks[${i}] must be a JSON object` };
      }
      const subtaskError = validateTaskFields(subtask, `task.subtasks[${i}]`, SUBTASK_TYPES);
      if (subtaskError) return { error: subtaskError };
      if (typeof subtask.description !== "string" || !subtask.description.trim()) {
        return { error: `task.subtasks[${i}].description is required` };
      }
      if (subtask.labels !== void 0) {
        const labelsError = validateStringArray(subtask.labels, `task.subtasks[${i}].labels`);
        if (labelsError) return { error: labelsError };
      }
      if (subtask.depends_on !== void 0) {
        if (!Array.isArray(subtask.depends_on)) {
          return { error: `task.subtasks[${i}].depends_on must be an array` };
        }
        for (const depIdx of subtask.depends_on) {
          if (!Number.isInteger(depIdx)) {
            return { error: `task.subtasks[${i}].depends_on values must be integers` };
          }
          if (depIdx < 0 || depIdx >= task.subtasks.length) {
            return { error: `task.subtasks[${i}].depends_on index ${depIdx} is out of range` };
          }
          if (depIdx === i) {
            return { error: `task.subtasks[${i}].depends_on cannot reference itself` };
          }
        }
      }
    }
  }
  return { value: task };
}
function validateTaskFields(task, path, allowedTypes) {
  if (typeof task.title !== "string" || !task.title.trim()) {
    return `${path}.title is required`;
  }
  if (typeof task.type !== "string" || !allowedTypes.has(task.type)) {
    return `${path}.type must be one of ${Array.from(allowedTypes).join(", ")}`;
  }
  if (!Number.isInteger(task.priority) || task.priority < 0 || task.priority > 4) {
    return `${path}.priority must be an integer from 0 to 4`;
  }
  const acceptance = normalizeTextOrArrayField(task.acceptance_criteria, `${path}.acceptance_criteria`);
  if (acceptance.error) return acceptance.error;
  if (acceptance.value !== void 0) task.acceptance_criteria = acceptance.value;
  return null;
}
function validateStringArray(value, path) {
  if (!Array.isArray(value)) return `${path} must be an array`;
  const invalidAt = value.findIndex((item) => typeof item !== "string");
  if (invalidAt !== -1) return `${path}[${invalidAt}] must be a string`;
  return null;
}
var CALLBACK_URL = process.env.JOB_CALLBACK_URL || "";
var CALLBACK_SECRET = process.env.JOB_CALLBACK_SECRET || "";
function sysLog(level, message, detail) {
  const port = process.env.WEB_PORT || process.env.PORT || 3e3;
  const body = JSON.stringify({ level, source: "job-runner", message, ...detail ? { detail } : {} });
  fetch(`http://localhost:${port}/api/system/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`
    },
    body,
    signal: AbortSignal.timeout(3e3)
  }).catch(() => {
  });
}
function readDefaultProfileRecord() {
  if (!(0, import_node_fs3.existsSync)(AGENT_PROFILES_DIR)) return null;
  for (const file of (0, import_node_fs3.readdirSync)(AGENT_PROFILES_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const profilePath = (0, import_node_path2.join)(AGENT_PROFILES_DIR, file);
    let profile;
    try {
      profile = JSON.parse((0, import_node_fs3.readFileSync)(profilePath, "utf-8"));
    } catch (err) {
      throw new Error(`Cannot read agent profile at ${profilePath}: ${err.message}`);
    }
    if (profile && profile.isDefault) return profile;
  }
  return null;
}
function resolveDefaultProfile() {
  const defaultProfile = readDefaultProfileRecord();
  if (!defaultProfile) return { cli: "claude", cliArgs: ["-p"], env: {} };
  const cli = typeof defaultProfile.cli === "string" && defaultProfile.cli.trim() ? defaultProfile.cli : "claude";
  const cliArgs = defaultProfile.pipe_flag ? splitProfileArgumentString(defaultProfile.pipe_flag, "pipe_flag") : defaultPipeArgsForCli(cli);
  cliArgs.push(...resolveProfilePermissionArgs(cli, defaultProfile.permission_flag));
  if (defaultProfile.model) cliArgs.push("--model", defaultProfile.model);
  if (Array.isArray(defaultProfile.extra_args)) {
    cliArgs.push(...defaultProfile.extra_args);
  }
  if (cli === "claude") {
    const raw = defaultProfile.disallowed_tools;
    const value = typeof raw === "string" ? raw.trim() : "Write Edit MultiEdit NotebookEdit";
    if (value) {
      cliArgs.push("--disallowed-tools", value);
    }
  }
  const env = defaultProfile.env && typeof defaultProfile.env === "object" ? resolveProfileEnvVars(defaultProfile.env) : {};
  return { cli, cliArgs, env };
}
var jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: node runner-job-worker.js <jobId>");
  process.exit(1);
}
var jobPaths;
try {
  jobPaths = resolveJobRecordPaths(JOBS_DIR, requireJobId(jobId));
} catch (err) {
  console.error("Invalid job id:", err.message);
  process.exit(1);
}
var jobPath = jobPaths.jobPath;
var job;
try {
  const content = (0, import_node_fs3.readFileSync)(jobPath, "utf-8");
  job = parseJobRecord(content);
} catch (err) {
  console.error("Failed to read job file:", err.message);
  process.exit(1);
}
job.status = "running";
job.startedAt = (/* @__PURE__ */ new Date()).toISOString();
job.activity = [{ time: (/* @__PURE__ */ new Date()).toISOString(), msg: "started" }];
try {
  persistJob(job);
} catch (err) {
  console.error("Failed to update job status:", err.message);
  process.exit(1);
}
sysLog("info", `job started: ${jobId}`, `type: ${job.type || "unknown"}, template: ${job.input?.template || "none"}`);
function addActivity(msg) {
  job.activity = job.activity || [];
  job.activity.push({ time: (/* @__PURE__ */ new Date()).toISOString(), msg });
  try {
    persistJob(job);
  } catch {
  }
}
async function notifyCompletion() {
  if (!CALLBACK_URL) return;
  try {
    const url = `${CALLBACK_URL.replace("[id]", jobId)}`;
    const headers = { "Content-Type": "application/json" };
    if (CALLBACK_SECRET) {
      headers["Authorization"] = `Bearer ${CALLBACK_SECRET}`;
    }
    if (NAMESPACE_ID) {
      headers["x-namespace-id"] = NAMESPACE_ID;
    }
    const body = JSON.stringify({
      status: job.status,
      result: job.result,
      error: job.error
    });
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5e3)
      // 5s timeout
    });
    if (!res.ok) {
      console.error("Callback failed:", res.status, res.statusText);
    }
  } catch (cbErr) {
    console.error("Callback error:", cbErr.message);
  }
}
var prompt = job.input.prompt || "";
if (!prompt) {
  job.status = "failed";
  job.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  job.error = `job.input.prompt is empty for type=${job.type}`;
  try {
    persistJob(job);
  } catch {
  }
  notifyCompletion().catch(() => {
  });
  process.exit(1);
}
var resolvedProfile;
try {
  resolvedProfile = resolveDefaultProfile();
} catch (err) {
  job.status = "failed";
  job.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  job.error = `agent profile is invalid: ${err.message}`;
  try {
    persistJob(job);
  } catch {
  }
  sysLog("error", `job failed: ${jobId}`, `invalid agent profile: ${err.message}`);
  notifyCompletion().catch(() => {
  });
  process.exit(1);
}
var resolvedCli = resolvedProfile.cli;
var resolvedArgs = resolvedProfile.cliArgs;
var profileEnv = resolvedProfile.env;
var childEnv = buildAiGatewayAgentEnv(process.env, profileEnv);
addActivity(describeCliLaunch(resolvedCli, resolvedArgs));
function isDirectory(candidate) {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    return (0, import_node_fs3.existsSync)(candidate) && (0, import_node_fs3.statSync)(candidate).isDirectory();
  } catch {
    return false;
  }
}
function loadRegisteredWorkspaces() {
  const workspacesPath = (0, import_node_path2.join)(ORG_ROOT, "workspaces.json");
  if (!(0, import_node_fs3.existsSync)(workspacesPath)) return [];
  try {
    const workspaces = JSON.parse((0, import_node_fs3.readFileSync)(workspacesPath, "utf-8"));
    return Array.isArray(workspaces) ? workspaces : [];
  } catch {
    return [];
  }
}
function canUseWorkspace(workspace) {
  if (!workspace?.path || !isDirectory(workspace.path)) return false;
  if (!Array.isArray(workspace.members) || workspace.members.length === 0) return true;
  return typeof job.createdBy === "string" && workspace.members.includes(job.createdBy);
}
function resolveWorkspaceCwd() {
  const identifiers = [
    job.input.workspaceCwd,
    job.input.workspacePath,
    job.input.workspaceId,
    job.input.workspace,
    process.env.JOB_WORKSPACE_CWD
  ].filter((value) => typeof value === "string" && value.trim());
  const workspaces = loadRegisteredWorkspaces();
  for (const value of identifiers) {
    const workspace = workspaces.find((w) => w?.id === value || w?.path === value);
    if (canUseWorkspace(workspace)) {
      return workspace.path;
    }
  }
  if (identifiers.length > 0) {
    addActivity("workspace cwd ignored: not registered or not accessible");
  }
  return PROJECT_ROOT;
}
var childCwd = resolveWorkspaceCwd();
childEnv.PWD = childCwd;
childEnv.MENTIKO_JOB_CWD = childCwd;
if (childCwd !== PROJECT_ROOT) {
  childEnv.MENTIKO_WORKSPACE_PATH = childCwd;
}
addActivity(`cwd ${childCwd}`);
var child = (0, import_node_child_process.spawn)(resolvedCli, resolvedArgs, {
  stdio: ["pipe", "pipe", "pipe"],
  timeout: RUNNER_CHILD_TIMEOUT_MS,
  env: childEnv,
  cwd: childCwd
});
var stdout = "";
var stderr = "";
var firstChunk = true;
child.stdout.on("data", (data) => {
  stdout += data.toString();
  if (firstChunk) {
    firstChunk = false;
    addActivity("receiving response");
  }
});
child.stderr.on("data", (data) => {
  stderr += data.toString();
});
child.stdin.write(prompt);
child.stdin.end();
child.on("error", async (err) => {
  await failJob(job, `spawn error: ${err.message}`);
  process.exit(1);
});
child.on("close", async (code) => {
  if (code !== 0) {
    const errDetail = stderr.slice(0, 500) || stdout.slice(0, 500) || `${resolvedCli} exited with code ${code}`;
    await failJob(job, errDetail);
    process.exit(1);
  }
  const cleaned = cleanAiOutput(stdout);
  if (job.type === "template_test") {
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
    }
    job.status = "complete";
    job.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    job.result = { raw: cleaned, parsed };
    try {
      persistJob(job);
    } catch (writeErr) {
      console.error("Failed to write completed job:", writeErr.message);
      process.exit(1);
    }
    sysLog("info", `job completed: ${jobId}`, `type: ${job.type}, output: ${cleaned.length} chars`);
    await notifyCompletion();
    process.exit(0);
  }
  let result = parseAiJsonOutput(stdout);
  if (!result) {
    await failJob(job, `No parseable JSON object found in AI output. Raw output (first 500 chars): ${cleaned.slice(0, 500)}`);
    process.exit(1);
  }
  if (job.type === "recommend" && !result.recommendation) {
    await failJob(job, "Invalid recommendation format");
    process.exit(1);
  }
  if (job.type === "generate" && !result.name) {
    await failJob(job, "Generated chain missing 'name' field");
    process.exit(1);
  }
  if (job.type === "task") {
    const taskValidation = validateGeneratedTask(result);
    if (taskValidation.error) {
      await failJob(job, taskValidation.error);
      process.exit(1);
    }
    result = taskValidation.value;
  }
  if (job.type === "decision_research" && !result.brief) {
    await failJob(job, "Research missing 'brief' object");
    process.exit(1);
  }
  if (job.type === "decision_guided_questions") {
    if (!Array.isArray(result.questions) || result.questions.length < 3) {
      await failJob(job, `Expected 5-8 questions, got ${Array.isArray(result.questions) ? result.questions.length : 0}`);
      process.exit(1);
    }
  }
  if (job.type === "decision_guided_options") {
    if (!Array.isArray(result.options) || result.options.length < 2) {
      await failJob(job, `Expected 4 options, got ${Array.isArray(result.options) ? result.options.length : 0}`);
      process.exit(1);
    }
  }
  if (job.type === "decision_guided_plan") {
    if (!Array.isArray(result.tasks) || result.tasks.length < 2) {
      await failJob(job, `Expected 5-15 tasks, got ${Array.isArray(result.tasks) ? result.tasks.length : 0}`);
      process.exit(1);
    }
  }
  if (job.type === "preference_synthesis" && !result.summary) {
    await failJob(job, "Preference synthesis missing 'summary' field");
    process.exit(1);
  }
  if (job.type === "link" && (!result.name || !result.mode)) {
    await failJob(job, "Link generation missing 'name' or 'mode' field");
    process.exit(1);
  }
  if (job.type === "link_summary" && (!result.headline || !result.outcome)) {
    await failJob(job, "Link summary missing 'headline' or 'outcome' field");
    process.exit(1);
  }
  if (job.type === "task_run_summary" && (!result.headline || !result.narrative || !result.outcome)) {
    await failJob(job, "Task run summary missing 'headline', 'narrative', or 'outcome' field");
    process.exit(1);
  }
  job.status = "complete";
  job.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  job.result = result;
  try {
    persistJob(job);
  } catch (writeErr) {
    console.error("Failed to write completed job:", writeErr.message);
    process.exit(1);
  }
  const elapsed = job.startedAt ? Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1e3) : 0;
  sysLog("info", `job completed: ${jobId}`, `type: ${job.type}, duration: ${elapsed}s`);
  await notifyCompletion();
  process.exit(0);
});
async function failJob(job2, errorMessage) {
  job2.status = "failed";
  job2.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  job2.error = errorMessage;
  try {
    persistJob(job2);
  } catch {
  }
  sysLog("error", `job failed: ${jobId}`, `type: ${job2.type || "unknown"}, error: ${errorMessage.slice(0, 200)}`);
  await notifyCompletion();
}
process.on("uncaughtException", async (err) => {
  await failJob(job, `Uncaught exception: ${err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", async (err) => {
  await failJob(job, `Unhandled rejection: ${err.message}`);
  process.exit(1);
});
process.on("exit", (code) => {
  if (job.status === "running") {
    job.status = "failed";
    job.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    job.error = job.error || `process exited unexpectedly (code ${code})`;
    try {
      persistJob(job);
    } catch {
    }
  }
});
function persistJob(record) {
  writeJobRecord(jobPaths.jobsDir, record);
}
