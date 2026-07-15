import { type SpawnOptions, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Typed owner of the remote audit-log shipper data contract.
 *
 * The shell predecessor (lib/audit-ship.sh) parsed the JSONL audit entry with
 * jq, derived the object-storage key, substituted the namespace, parsed the S3
 * URL, orchestrated the rclone upload with retry backoff, and built the failure
 * breadcrumb — all in shell. This module owns every one of those records and
 * mutations; the shell entrypoint is now an invocation-only process boundary
 * that forwards stdin to the compiled bundle.
 *
 * Semantics are preserved byte-for-byte against the shell derivation (epoch
 * truncation, last-underscore short id, lexicographic date partition, trailing
 * single-slash prefix trim, namespace substitution, failure-record shape).
 */

const BACKOFF_DELAYS_MS = [1000, 5000, 15000];
const MAX_ATTEMPTS = 3;

export interface AuditEntry {
  id?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
}

export type AuditShipStatus =
  | { status: "disabled" }
  | { status: "malformed"; url: string }
  | { status: "ok"; bucket: string; remoteKey: string; entryId: string; remoteUrl: string; epochMs: number };

export interface AuditShipFailureRecord {
  failedAt: string;
  entryId: string;
  remoteKey: string;
  remoteUrl: string;
  attempts: number;
}

export type AuditEnvironment = Record<string, string | undefined>;
export type SpawnResult = (command: string, args: string[], env: AuditEnvironment) => Promise<number>;

export interface AuditShipDeps {
  env?: AuditEnvironment;
  now?: () => Date;
  random?: () => number;
  spawnRclone?: SpawnResult;
  sleep?: (ms: number) => Promise<void>;
  mkdtemp?: (prefix: string) => string;
  writeFile?: (path: string, data: string) => void;
  removeFile?: (path: string) => void;
  appendFile?: (path: string, data: string) => void;
  stderr?: (line: string) => void;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Decode the raw JSONL line without applying record defaults. */
export function parseRawAuditJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("audit ship received an empty JSONL entry");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(`audit ship received invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Validate the raw record boundary before normalized key derivation. */
export function validateRawAuditEntry(value: unknown): AuditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("audit ship entry must be a JSON object");
  }
  return value as AuditEntry;
}

/** Normalize the fields used for a remote object key. Missing/invalid identity
 * fields are rejected rather than turned into an invented `unknown` record. */
export function normalizeAuditEntry(value: AuditEntry): AuditEntry {
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("audit ship entry id is required");
  if (typeof value.timestamp !== "string" || !value.timestamp.trim()) throw new Error("audit ship entry timestamp is required");
  if (Number.isNaN(Date.parse(value.timestamp))) throw new Error("audit ship entry timestamp is invalid");
  return value;
}

/** Parse and validate one raw JSONL audit record. */
export function parseAuditEntry(raw: string): AuditEntry {
  return normalizeAuditEntry(validateRawAuditEntry(parseRawAuditJson(raw)));
}

/** Epoch milliseconds for the object key. No timestamp (or unparseable
 *  timestamp) falls back to the current second; a missing timestamp adds the
 *  0..999ms jitter the shell RANDOM path produced. A present, parseable
 *  timestamp is truncated to the whole second, matching `epoch_s * 1000`. */
export function deriveEpochMs(entry: AuditEntry, now: () => Date, random: () => number): number {
  const ts = stringValue(entry.timestamp);
  const secondFloor = (d: Date) => Math.floor(d.getTime() / 1000) * 1000;
  if (!ts) return secondFloor(now()) + Math.floor(random() * 1000);
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return secondFloor(now());
  return Math.floor(parsed / 1000) * 1000;
}

/** First eight characters of the id segment after the last underscore; "unknown"
 *  when no id is present. */
export function deriveShortId(entry: AuditEntry): string {
  const id = stringValue(entry.id) || "unknown";
  const afterUnderscore = id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : id;
  return afterUnderscore.slice(0, 8);
}

/** Year/month/day partition sliced lexicographically from the timestamp date
 *  part (the text before "T"); falls back to the current local date. */
export function deriveDatePartition(entry: AuditEntry, now: () => Date): { year: string; month: string; day: string } {
  const ts = stringValue(entry.timestamp);
  let datePart = ts ? ts.split("T")[0] : "";
  if (!datePart) {
    const d = now();
    const pad = (n: number) => String(n).padStart(2, "0");
    datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return { year: datePart.slice(0, 4), month: datePart.slice(5, 7), day: datePart.slice(8, 10) };
}

/** Split an S3-style URL into bucket + prefix. Returns null when no bucket can
 *  be derived (malformed). Trims a single trailing slash from the prefix, as the
 *  shell `${url_prefix%/}` did. */
export function parseS3Url(remoteUrl: string): { bucket: string; prefix: string } | null {
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

/** Resolve the full ship target from an entry + environment. */
export function resolveAuditTarget(entry: AuditEntry, env: AuditEnvironment, now: () => Date, random: () => number): AuditShipStatus {
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

/** Compact JSON line for the ship-failure breadcrumb (replaces `jq -nc`). */
export function buildFailureEntry(record: AuditShipFailureRecord): string {
  return JSON.stringify({
    failed_at: record.failedAt,
    entry_id: record.entryId,
    remote_key: record.remoteKey,
    remote_url: record.remoteUrl,
    attempts: record.attempts,
  });
}

/** rclone argv + credential env for a single copyto attempt. */
export function buildRcloneInvocation(sourcePath: string, target: { bucket: string; remoteKey: string }, env: AuditEnvironment): { args: string[]; spawnEnv: AuditEnvironment } {
  const args = [
    "copyto",
    sourcePath,
    `:s3:${target.bucket}/${target.remoteKey}`,
    "--s3-provider=Other",
    `--s3-endpoint=${stringValue(env.AUDIT_S3_ENDPOINT)}`,
    "--s3-env-auth=false",
    "--quiet",
  ];
  const spawnEnv: AuditEnvironment = {
    ...env,
    RCLONE_S3_ACCESS_KEY_ID: stringValue(env.AUDIT_REMOTE_ACCESS_KEY),
    RCLONE_S3_SECRET_ACCESS_KEY: stringValue(env.AUDIT_REMOTE_SECRET_KEY),
  };
  return { args, spawnEnv };
}

function defaultSpawnRclone(cwd: string): SpawnResult {
  return (command, args, env) =>
    new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ["ignore", "ignore", "ignore"], env: env as NodeJS.ProcessEnv, cwd } satisfies SpawnOptions);
      child.on("error", () => resolve(1));
      child.on("close", (code) => resolve(code ?? 1));
    });
}

function isoSecondUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function resolveFailureLog(env: AuditEnvironment): string {
  const namespaceRoot = stringValue(env.NAMESPACE_ROOT);
  return join(env.AUDIT_DIR ? stringValue(env.AUDIT_DIR) : namespaceRoot ? `${namespaceRoot}/audit` : "audit", "ship-failures.log");
}

/**
 * Ship a single JSONL audit entry to remote object storage. Orchestrates the
 * rclone upload with retry backoff and records a durable failure breadcrumb on
 * exhaustion. Audit shipping NEVER blocks the main flow: every path returns 0.
 */
export async function shipAuditEntry(entryLine: string, deps: AuditShipDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  if (!entryLine.trim() || !env.AUDIT_REMOTE_URL) return 0;
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  let entry: AuditEntry;
  try {
    entry = parseAuditEntry(entryLine);
  } catch (error) {
    (deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`)))
      (`warn: audit ship rejected raw entry: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }

  const target = resolveAuditTarget(entry, env, now, random);
  if (target.status === "disabled") return 0;
  if (target.status === "malformed") {
    (deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`)))(
      `warn: AUDIT_REMOTE_URL malformed, cannot derive bucket: ${target.url}`,
    );
    return 0;
  }

  const mkdtemp = deps.mkdtemp ?? ((prefix: string) => mkdtempSync(join(tmpdir(), prefix)));
  const writeFile = deps.writeFile ?? ((path, data) => writeFileSync(path, data));
  // mkdtemp creates a directory containing the staged entry. Cleanup must
  // remove that directory recursively; a non-recursive rmSync succeeds only
  // for files and would throw after every real upload on macOS/Linux.
  const removeFile = deps.removeFile ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const tempDir = mkdtemp("audit-ship-");
  const tempEntry = join(tempDir, "entry.json");
  try {
    writeFile(tempEntry, entryLine.endsWith("\n") ? entryLine : `${entryLine}\n`);
    const { args, spawnEnv } = buildRcloneInvocation(tempEntry, target, env);
    const spawnRclone = deps.spawnRclone ?? defaultSpawnRclone(tempDir);
    const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

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
    attempts: MAX_ATTEMPTS,
  });
  const appendFile = deps.appendFile ?? ((path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, data);
  });
  try {
    appendFile(failureLog, `${failureLine}\n`);
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

function parseFlags(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) {
      throw new Error("Invalid runner audit-ship argument list.");
    }
    values.set(flag, value);
  }
  return values;
}

/**
 * CLI entry for the compiled bundle. `ship` reads one JSONL entry from stdin and
 * performs the full remote upload. Always exits 0 (shipping never blocks).
 */
export async function runAuditShipCli(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command !== "ship") {
    throw new Error("usage: runner-audit-ship ship  (reads one JSONL audit entry from stdin)");
  }
  const flags = parseFlags(argv.slice(1));
  if (flags.size) throw new Error("runner-audit-ship ship takes no flags.");
  const entryLine = await readStdin();
  return shipAuditEntry(entryLine);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

if (require.main === module) {
  runAuditShipCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`runner audit-ship failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 0;
    });
}
