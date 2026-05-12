import { exec } from "child_process";
import { promisify } from "util";
import config from "@/lib/config";

const execAsync = promisify(exec);

// quote value for bash single-quoted context. escapes embedded single quotes
// by closing-then-reopening the quote ('\''). safe against command injection
// for any string argument passed into `cmd`.
//
// NOTE: only apply to values that land inside the shell command string.
// values passed via the `env` option are handed to the child process directly
// and are NOT shell-interpreted — do not escape those.
export function shellEscape(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

export interface AuditLogMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

function buildMetadataPairs(metadata: AuditLogMetadata): string {
  return Object.entries(metadata)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${shellEscape(k)}=${shellEscape(String(v))}`)
    .join(" ");
}

function sanitizeIpForEnv(ip: string | undefined): string {
  if (!ip) return "";
  // ipv4 or ipv6; strip anything else. env var is not shell-interpreted
  // but a malformed value gets recorded in the audit log, so keep it clean.
  const trimmed = ip.trim();
  if (/^[\d.]+$/.test(trimmed) || /^[\da-f:]+$/i.test(trimmed)) {
    return trimmed;
  }
  return "unknown";
}

export interface AuditExecOptions {
  source?: string;   // AUDIT_SOURCE (defaults to "web")
  ip?: string;       // AUDIT_IP (defaults to empty)
  timeoutMs?: number;
}

// Run `audit-log` in bash with all user inputs shell-escaped.
//
// Must use /bin/bash explicitly: audit-log.sh defines functions with hyphens
// in their names (e.g. `audit-log`, `audit-query`), which POSIX /bin/sh
// rejects as "not a valid identifier". child_process.exec uses /bin/sh by
// default.
export async function execAuditLog(
  eventType: string,
  description: string,
  metadata: AuditLogMetadata = {},
  options: AuditExecOptions = {}
): Promise<string> {
  const metadataPairs = buildMetadataPairs(metadata);
  const cmd =
    `source lib/config.sh && ` +
    `source lib/audit-log.sh && ` +
    `audit-log ${shellEscape(eventType)} ${shellEscape(description)}` +
    (metadataPairs ? ` ${metadataPairs}` : "");

  const { stdout } = await execAsync(cmd, {
    cwd: config.root,
    shell: "/bin/bash",
    env: {
      ...process.env,
      AUDIT_SOURCE: options.source ?? "web",
      AUDIT_IP: sanitizeIpForEnv(options.ip),
    },
    timeout: options.timeoutMs ?? 30000,
  });

  return stdout.trim();
}

export interface AuditQueryArgs {
  filterType: string;
  filterValue?: string;
  since?: string;
  limit?: string | number;
}

// Run `audit-query` in bash with all user inputs shell-escaped.
// See execAuditLog for why shell must be /bin/bash.
export async function execAuditQuery(
  args: AuditQueryArgs,
  options: AuditExecOptions = {}
): Promise<string> {
  const filterType = args.filterType || "all";
  const filterValue = args.filterValue ?? "";
  const since = args.since ?? "";
  const limit = String(args.limit ?? "100");

  const cmd =
    `source lib/config.sh && ` +
    `source lib/audit-log.sh && ` +
    `audit-query ${shellEscape(filterType)} ${shellEscape(filterValue)} ` +
    `${shellEscape(since)} ${shellEscape(limit)}`;

  const { stdout } = await execAsync(cmd, {
    cwd: config.root,
    shell: "/bin/bash",
    env: {
      ...process.env,
      AUDIT_SOURCE: options.source ?? "web",
      AUDIT_IP: sanitizeIpForEnv(options.ip),
    },
    timeout: options.timeoutMs ?? 30000,
  });

  return stdout;
}
