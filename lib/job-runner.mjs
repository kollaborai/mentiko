#!/usr/bin/env node
/**
 * Standalone job runner - executed via spawn() for background AI jobs.
 * Reads job file, spawns claude CLI via stdin, writes result back atomically.
 *
 * Usage: node lib/job-runner.mjs <jobId>
 *
 * This runs as a detached process, surviving API handler lifecycle.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createDecipheriv, createHash, createHmac, pbkdf2Sync } from "node:crypto";
// spawn imported inline below to avoid top-level collision with the detached child

// 3-tier data hierarchy: global > namespace > org > project
const MENTIKO_GLOBAL_ROOT = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || join(homedir(), '.mentiko');
const NAMESPACE_ID = process.env.NAMESPACE_ID || 'default';
const NAMESPACE_ROOT = join(MENTIKO_GLOBAL_ROOT, 'namespaces', NAMESPACE_ID);
const ORG_ID = process.env.ORG_ID || 'default';
// default org collapses to namespace root (no /orgs/default path)
const ORG_ROOT = process.env.MENTIKO_ORG_ROOT || (ORG_ID === 'default' ? NAMESPACE_ROOT : join(NAMESPACE_ROOT, 'orgs', ORG_ID));
// default project collapses to org root
const PROJECT_ROOT = process.env.MENTIKO_PROJECT_ROOT || ORG_ROOT;
const JOBS_DIR = join(PROJECT_ROOT, 'jobs');
const AGENT_PROFILES_DIR = join(ORG_ROOT, 'agent-profiles');
const SECRETS_DIR = join(ORG_ROOT, 'secrets');

// ── secret decryption ─────────────────────────────────────────────────────────

const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
const KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";
const KEY_DERIVATION_ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32;

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
  const prk = createHmac("sha256", "\x00".repeat(32)).update(rootSecret).digest();
  return createHmac("sha256", prk).update(`${KEY_DERIVATION_LABEL}\x01`).digest("hex");
}

function getDerivedKey() {
  // double HKDF to match secrets-store.ts
  const appSecret = deriveVaultAppSecret(deriveVaultAppSecret(getVaultSecret()));
  return pbkdf2Sync(
    appSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}

function getLegacyDerivedKey() {
  const rawSecret = getLegacyVaultSecret();
  return pbkdf2Sync(
    rawSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}

function getKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function decrypt(ciphertext) {
  try {
    if (ciphertext.startsWith("v1:")) {
      // v1 format: v1:keyId:ivHex:tagHex:encHex
      const parts = ciphertext.split(":", 5);
      if (parts.length !== 5) return null;
      const [, keyIdStored, ivHex, tagHex, encHex] = parts;

      const key = getDerivedKey();
      const keyId = getKeyId(key);
      if (keyIdStored !== keyId) {
        return null;
      }

      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
    }

    // v0 format: ivHex:tagHex:encHex (legacy)
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
        const decipher = createDecipheriv("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
      } catch {
        // try fallback
      }
    }

    return null;
  } catch (err) {
    return null;
  }
}

function getSecretByName(name) {
  if (!existsSync(SECRETS_DIR)) return null;
  for (const f of readdirSync(SECRETS_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const rec = JSON.parse(readFileSync(join(SECRETS_DIR, f), 'utf8'));
      if (rec.name === name && rec.encryptedValue) {
        const val = decrypt(rec.encryptedValue);
        if (!val) {
          console.error(`[secrets] decryption failed: ${rec.id} — key mismatch or corrupt`);
        }
        return val;
      }
    } catch (err) {
      console.error(`[secrets] error reading secret: ${f}`);
    }
  }
  return null;
}

const SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;

function resolveProfileEnvVars(profileEnv) {
  const result = {};
  for (const [key, value] of Object.entries(profileEnv)) {
    const match = value.match(SECRET_REF_PATTERN);
    if (match) {
      const secretName = match[1];
      const secretValue = getSecretByName(secretName);
      if (secretValue !== null) {
        result[key] = secretValue;
      } else {
        // secret not found - leave reference as-is (will fail at runtime)
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function splitProfileArgs(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((arg) => arg.replace(/^(['"])(.*)\1$/, "$2"));
}

// callback URL to notify when job completes (from server)
const CALLBACK_URL = process.env.JOB_CALLBACK_URL || "";
const CALLBACK_SECRET = process.env.JOB_CALLBACK_SECRET || "";

/** POST to /api/system/logs (non-blocking, fire-and-forget) */
function sysLog(level, message, detail) {
  const port = process.env.WEB_PORT || 3000;
  const body = JSON.stringify({ level, source: "job-runner", message, ...(detail ? { detail } : {}) });
  fetch(`http://localhost:${port}/api/system/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`,
    },
    body,
    signal: AbortSignal.timeout(3000),
  }).catch(() => {}); // fire-and-forget
}

// resolve default agent profile from filesystem (reads agent-profiles, not config-profiles)
function resolveDefaultProfile() {
  let cli = "claude";
  let cliArgs = ["-p"];
  let env = {};

  try {
    if (!existsSync(AGENT_PROFILES_DIR)) return { cli, cliArgs, env };

    // scan agent-profiles dir for the one with isDefault=true
    const files = readdirSync(AGENT_PROFILES_DIR).filter(f => f.endsWith(".json"));
    let defaultProfile = null;
    for (const file of files) {
      const profile = JSON.parse(readFileSync(join(AGENT_PROFILES_DIR, file), "utf-8"));
      if (profile.isDefault) {
        defaultProfile = profile;
        break;
      }
    }
    if (!defaultProfile) return { cli, cliArgs, env };

    if (defaultProfile.cli) cli = defaultProfile.cli;
    if (defaultProfile.pipe_flag) cliArgs = splitProfileArgs(defaultProfile.pipe_flag);
    else cliArgs = ["-p"];
    if (defaultProfile.permission_flag) cliArgs.push(...splitProfileArgs(defaultProfile.permission_flag));
    if (defaultProfile.model) cliArgs.push("--model", defaultProfile.model);
    if (Array.isArray(defaultProfile.extra_args)) {
      cliArgs.push(...defaultProfile.extra_args);
    }
    // disallowed_tools: space-separated list of tools to block. only the claude CLI
    // supports --disallowed-tools; other CLIs ignore it. jobs need structured JSON
    // output, so Write/Edit/MultiEdit/NotebookEdit default to blocked — otherwise the
    // model "helpfully" drops a file and narrates instead of returning JSON. users
    // can override in settings → agent-configs (set to empty string to allow all).
    if (cli === "claude") {
      const raw = defaultProfile.disallowed_tools;
      let value;
      if (typeof raw === "string") {
        value = raw.trim(); // empty string = explicit opt-out
      } else {
        value = "Write Edit MultiEdit NotebookEdit"; // undefined = apply safe default
      }
      if (value) {
        cliArgs.push("--disallowed-tools", value);
      }
    }
    if (defaultProfile.env && typeof defaultProfile.env === "object") {
      // resolve {secret:NAME} references to actual values
      env = resolveProfileEnvVars(defaultProfile.env);
    }
  } catch {
    // fallback to defaults on any error
  }

  return { cli, cliArgs, env };
}

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: node job-runner.mjs <jobId>");
  process.exit(1);
}

const jobPath = join(JOBS_DIR, `${jobId}.json`);
const tmpPath = join(JOBS_DIR, `${jobId}.tmp`);

// read job input
let job;
try {
  const content = readFileSync(jobPath, "utf-8");
  job = JSON.parse(content);
} catch (err) {
  console.error("Failed to read job file:", err.message);
  process.exit(1);
}

// mark as running
job.status = "running";
job.startedAt = new Date().toISOString();
job.activity = [{ time: new Date().toISOString(), msg: "started" }];

try {
  writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
  renameSync(tmpPath, jobPath);
} catch (err) {
  console.error("Failed to update job status:", err.message);
  process.exit(1);
}

sysLog("info", `job started: ${jobId}`, `type: ${job.type || "unknown"}, template: ${job.input?.template || "none"}`);

function addActivity(msg) {
  job.activity = job.activity || [];
  job.activity.push({ time: new Date().toISOString(), msg });
  try {
    writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
    renameSync(tmpPath, jobPath);
  } catch { /* non-fatal */ }
}

// notify server that job completed (updates task metadata)
async function notifyCompletion() {
  if (!CALLBACK_URL) return; // no callback configured, skip

  try {
    const url = `${CALLBACK_URL.replace('[id]', jobId)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (CALLBACK_SECRET) {
      headers['Authorization'] = `Bearer ${CALLBACK_SECRET}`;
    }
    if (NAMESPACE_ID) {
      headers['x-namespace-id'] = NAMESPACE_ID;
    }

    const body = JSON.stringify({
      status: job.status,
      result: job.result,
      error: job.error,
    });

    // native fetch (Node 18+)
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!res.ok) {
      console.error('Callback failed:', res.status, res.statusText);
    }
  } catch (cbErr) {
    // non-fatal - job result is already written to disk
    console.error('Callback error:', cbErr.message);
  }
}

// all job types: the route resolves the generation template and stores the full
// prompt in job.input.prompt — job-runner just runs it
const prompt = job.input.prompt || "";
if (!prompt) {
  // early exit: write failed job synchronously, fire callback without await
  job.status = "failed";
  job.completedAt = new Date().toISOString();
  job.error = `job.input.prompt is empty for type=${job.type}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
    renameSync(tmpPath, jobPath);
  } catch {}
  // fire-and-forget callback - process will exit before it completes, but that's ok
  notifyCompletion().catch(() => {});
  process.exit(1);
}


// run the AI prompt via cli - use spawn + stdin to avoid shell escaping issues
import { spawn as spawnProcess } from "node:child_process";

// resolve CLI binary, args, and env from default profile
const { cli: resolvedCli, cliArgs: resolvedArgs, env: profileEnv } = resolveDefaultProfile();

// remove CLAUDECODE so claude binary doesn't refuse to run inside another session
// then apply profile env vars (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, etc.)
const childEnv = Object.assign({}, process.env, profileEnv);
delete childEnv.CLAUDECODE;
// if no profile explicitly sets ANTHROPIC_API_KEY, strip any inherited key
// so claude falls back to OAuth/plan auth (prevents stale keys from hijacking)
if (!profileEnv.ANTHROPIC_API_KEY) {
  delete childEnv.ANTHROPIC_API_KEY;
}

addActivity(`spawning ${resolvedCli}`);

function isDirectory(candidate) {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function loadRegisteredWorkspaces() {
  const workspacesPath = join(ORG_ROOT, "workspaces.json");
  if (!existsSync(workspacesPath)) return [];
  try {
    const workspaces = JSON.parse(readFileSync(workspacesPath, "utf-8"));
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
    process.env.JOB_WORKSPACE_CWD,
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

const childCwd = resolveWorkspaceCwd();
childEnv.PWD = childCwd;
childEnv.MENTIKO_JOB_CWD = childCwd;
if (childCwd !== PROJECT_ROOT) {
  childEnv.MENTIKO_WORKSPACE_PATH = childCwd;
}
addActivity(`cwd ${childCwd}`);

const child = spawnProcess(resolvedCli, resolvedArgs, {
  stdio: ["pipe", "pipe", "pipe"],
  timeout: 480000,
  env: childEnv,
  cwd: childCwd,
});

let stdout = "";
let stderr = "";
let firstChunk = true;

child.stdout.on("data", (data) => {
  stdout += data.toString();
  if (firstChunk) {
    firstChunk = false;
    addActivity("receiving response");
  }
});
child.stderr.on("data", (data) => { stderr += data.toString(); });

// write prompt to stdin (no shell interpolation = no escaping bugs)
child.stdin.write(prompt);
child.stdin.end();

child.on("error", async (err) => {
  await failJob(job, `spawn error: ${err.message}`);
  process.exit(1);
});

child.on("close", async (code) => {
  if (code !== 0) {
    // claude -p sends errors (e.g. "Credit balance is too low") to stdout, not stderr
    const errDetail = stderr.slice(0, 500) || stdout.slice(0, 500) || `${resolvedCli} exited with code ${code}`;
    await failJob(job, errDetail);
    process.exit(1);
  }

  const cleaned = stdout
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  // template_test: store raw output, no JSON required
  if (job.type === "template_test") {
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch { /* not JSON */ }
    job.status = "complete";
    job.completedAt = new Date().toISOString();
    job.result = { raw: cleaned, parsed };

    try {
      writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
      renameSync(tmpPath, jobPath);
    } catch (writeErr) {
      console.error("Failed to write completed job:", writeErr.message);
      process.exit(1);
    }
    sysLog("info", `job completed: ${jobId}`, `type: ${job.type}, output: ${cleaned.length} chars`);
    await notifyCompletion();
    process.exit(0);
  }

  let result;
  try {
    result = JSON.parse(cleaned);
  } catch {
    // try to extract JSON object from surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        result = JSON.parse(jsonMatch[0]);
      } catch {
        await failJob(job, `Failed to parse AI output as JSON. Raw output (first 500 chars): ${cleaned.slice(0, 500)}`);
        process.exit(1);
      }
    } else {
      await failJob(job, `No JSON object found in AI output. Raw output (first 500 chars): ${cleaned.slice(0, 500)}`);
      process.exit(1);
    }
  }

  // validate result
  if (job.type === "recommend" && !result.recommendation) {
    await failJob(job, "Invalid recommendation format");
    process.exit(1);
  }
  if (job.type === "generate" && !result.name) {
    await failJob(job, "Generated chain missing 'name' field");
    process.exit(1);
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

  // success - write result back
  job.status = "complete";
  job.completedAt = new Date().toISOString();
  job.result = result;

  try {
    writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
    renameSync(tmpPath, jobPath);
  } catch (writeErr) {
    console.error("Failed to write completed job:", writeErr.message);
    process.exit(1);
  }

  const elapsed = job.startedAt ? Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000) : 0;
  sysLog("info", `job completed: ${jobId}`, `type: ${job.type}, duration: ${elapsed}s`);
  await notifyCompletion();
  process.exit(0);
});

async function failJob(job, errorMessage) {
  job.status = "failed";
  job.completedAt = new Date().toISOString();
  job.error = errorMessage;

  try {
    writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
    renameSync(tmpPath, jobPath);
  } catch {}

  sysLog("error", `job failed: ${jobId}`, `type: ${job.type || "unknown"}, error: ${errorMessage.slice(0, 200)}`);

  // notify server of failure
  await notifyCompletion();
}

// handle uncaught errors
process.on("uncaughtException", async (err) => {
  await failJob(job, `Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", async (err) => {
  await failJob(job, `Unhandled rejection: ${err.message}`);
  process.exit(1);
});

// last-resort: if process exits without completing, mark job failed synchronously
process.on("exit", (code) => {
  if (job.status === "running") {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = job.error || `process exited unexpectedly (code ${code})`;
    try {
      writeFileSync(tmpPath, JSON.stringify(job, null, 2), "utf-8");
      renameSync(tmpPath, jobPath);
    } catch { /* truly last resort, nothing more we can do */ }
  }
});
