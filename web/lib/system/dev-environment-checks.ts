import { resolve } from "path";

export type DevCheckStatus = "pass" | "warn" | "fail";

export type PtyManagerCandidateSource =
  | "env"
  | "sibling"
  | "installed"
  | "repo-wrapper";

export interface DevCheck {
  id: string;
  label: string;
  status: DevCheckStatus;
  message: string;
  remediation?: string;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface PtyManagerCandidate {
  label: string;
  path: string;
  source: PtyManagerCandidateSource;
}

export function checkNodeVersion(
  version: string,
  minimumMajor = 22,
): DevCheck {
  const match = version.match(/^v?(\d+)\./);
  const major = match ? Number(match[1]) : Number.NaN;

  if (!Number.isFinite(major)) {
    return {
      id: "node-version",
      label: "Node.js",
      status: "fail",
      message: `Could not read Node version from ${version || "(empty)"}`,
      remediation: `Install Node ${minimumMajor} or newer, then rerun npm run setup.`,
    };
  }

  if (major < minimumMajor) {
    return {
      id: "node-version",
      label: "Node.js",
      status: "fail",
      message: `Found ${version}; Mentiko expects Node ${minimumMajor} or newer.`,
      remediation: `Install Node ${minimumMajor} or newer, then rerun npm run setup.`,
    };
  }

  return {
    id: "node-version",
    label: "Node.js",
    status: "pass",
    message: `Found ${version}.`,
  };
}

export function getPtyManagerCandidates(options: {
  cwd?: string;
  env?: Record<string, string | undefined>;
} = {}): PtyManagerCandidate[] {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const home = env.HOME;
  const candidates: PtyManagerCandidate[] = [];
  const seen = new Set<string>();

  function add(candidate: PtyManagerCandidate) {
    if (!candidate.path || seen.has(candidate.path)) return;
    seen.add(candidate.path);
    candidates.push(candidate);
  }

  if (env.PTY_MGR_BIN) {
    add({
      label: "PTY_MGR_BIN override",
      path: resolve(cwd, env.PTY_MGR_BIN),
      source: "env",
    });
  }

  if (env.MENTIKO_PTY_MGR_BIN) {
    add({
      label: "MENTIKO_PTY_MGR_BIN override",
      path: resolve(cwd, env.MENTIKO_PTY_MGR_BIN),
      source: "env",
    });
  }

  add({
    label: "local pty-mgr checkout",
    path: resolve(cwd, "..", "..", "pty-mgr", "dist", "pty-mgr"),
    source: "sibling",
  });

  if (home) {
    add({
      label: "installed pty-mgr",
      path: resolve(cwd, home, ".pty-mgr", "bin", "pty-mgr"),
      source: "installed",
    });
  }

  add({
    label: "repo pty-mgr wrapper",
    path: resolve(cwd, "..", "bin", "pty-mgr"),
    source: "repo-wrapper",
  });

  return candidates;
}

export function getPtyManagerInstallScriptPath(options: { cwd?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();
  return resolve(cwd, "..", "..", "pty-mgr", "install.sh");
}

export function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function upsertEnvContent(
  content: string,
  values: Record<string, string>,
): { content: string; changed: boolean } {
  const pending = new Map(Object.entries(values));
  const lines = content.split("\n");
  const output: string[] = [];
  let changed = false;

  for (const line of lines) {
    if (line === "" && output.length === lines.length - 1) continue;
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    const key =
      trimmed && !trimmed.startsWith("#") && eq > 0
        ? trimmed.slice(0, eq).trim()
        : "";

    if (key && pending.has(key)) {
      const next = `${key}=${pending.get(key)}`;
      output.push(next);
      if (line !== next) changed = true;
      pending.delete(key);
    } else if (line !== "" || output.length > 0) {
      output.push(line);
    }
  }

  const additions = Array.from(pending.entries()).map(
    ([key, value]) => `${key}=${value}`,
  );
  if (additions.length > 0) {
    if (output.length === 0) {
      output.push("# Local Mentiko development defaults");
    } else if (output[output.length - 1] !== "") {
      output.push("");
    }
    output.push(...additions);
    changed = true;
  }

  return {
    content: `${output.join("\n")}\n`,
    changed,
  };
}

export function checkCommandResult(options: {
  id: string;
  label: string;
  passMessage: string;
  failMessage: string;
  remediation: string;
  result: CommandResult;
  warnOnly?: boolean;
}): DevCheck {
  const { id, label, passMessage, failMessage, remediation, result, warnOnly } =
    options;

  if (result.status === 0) {
    return {
      id,
      label,
      status: "pass",
      message: passMessage,
    };
  }

  const detail = [result.error, result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join(" ");

  return {
    id,
    label,
    status: warnOnly ? "warn" : "fail",
    message: detail ? `${failMessage}: ${detail}` : failMessage,
    remediation,
  };
}

export function summarizeChecks(checks: DevCheck[]): {
  ok: boolean;
  failed: number;
  warned: number;
} {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  return {
    ok: failed === 0,
    failed,
    warned,
  };
}

export function renderDoctorReport(checks: DevCheck[]): string {
  const summary = summarizeChecks(checks);
  const lines = ["Mentiko dev environment", ""];

  for (const check of checks) {
    lines.push(`${check.status.toUpperCase()} ${check.label}: ${check.message}`);
    if (check.remediation && check.status !== "pass") {
      lines.push(`  Fix: ${check.remediation}`);
    }
  }

  lines.push("");
  if (summary.ok) {
    lines.push(
      summary.warned > 0
        ? `Ready with ${summary.warned} warning${summary.warned === 1 ? "" : "s"}.`
        : "Ready.",
    );
  } else {
    lines.push(
      `${summary.failed} check${summary.failed === 1 ? "" : "s"} failed. Run npm run setup, then npm run doctor.`,
    );
  }

  return `${lines.join("\n")}\n`;
}
