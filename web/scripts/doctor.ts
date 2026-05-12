import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  checkCommandResult,
  checkNodeVersion,
  getPtyManagerCandidates,
  parseEnvContent,
  renderDoctorReport,
  summarizeChecks,
  type CommandResult,
  type DevCheck,
  type PtyManagerCandidate,
} from "../lib/dev-environment-checks";

const args = new Set(process.argv.slice(2));
const preflight = args.has("--preflight");

function run(command: string, commandArgs: string[]): CommandResult {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    timeout: 10_000,
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message,
  };
}

function formatCommandFailure(result: CommandResult): string {
  return [result.error, result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join(" ");
}

function checkPtyManager(): DevCheck {
  const failures: string[] = [];
  const env = {
    ...readEnvLocal(),
    ...process.env,
  };

  for (const candidate of getPtyManagerCandidates({ env })) {
    const result = run(candidate.path, ["--help"]);
    if (result.status === 0) {
      return {
        id: "pty-mgr",
        label: "PTY manager",
        status: "pass",
        message: `${candidate.label} is available at ${candidate.path}.`,
      };
    }

    const detail = formatCommandFailure(result);
    failures.push(formatPtyCandidate(candidate, detail));
  }

  return {
    id: "pty-mgr",
    label: "PTY manager",
    status: "fail",
    message: `No usable pty-mgr was found. Checked ${failures.join("; ")}.`,
    remediation:
      "Run npm run setup, build ../pty-mgr with npm run build, or set MENTIKO_PTY_MGR_BIN to a working binary.",
  };
}

function readEnvLocal(): Record<string, string> {
  const envPath = join(process.cwd(), ".env.local");
  return existsSync(envPath) ? parseEnvContent(readFileSync(envPath, "utf8")) : {};
}

function formatPtyCandidate(candidate: PtyManagerCandidate, detail: string): string {
  return detail
    ? `${candidate.label} (${candidate.path}): ${detail}`
    : `${candidate.label} (${candidate.path})`;
}

async function checkEngineHealth(): Promise<DevCheck> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch("http://127.0.0.1:7433/health", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return {
        id: "kollabor-engine-health",
        label: "Kollabor engine runtime",
        status: "pass",
        message: "Engine is responding on 127.0.0.1:7433.",
      };
    }

    return {
      id: "kollabor-engine-health",
      label: "Kollabor engine runtime",
      status: "warn",
      message: `Engine health returned HTTP ${response.status}.`,
      remediation: "Run npm run dev to start the full local stack.",
    };
  } catch {
    return {
      id: "kollabor-engine-health",
      label: "Kollabor engine runtime",
      status: "warn",
      message: "Engine is not currently listening on 127.0.0.1:7433.",
      remediation: "Run npm run dev to start the full local stack.",
    };
  }
}

async function main() {
  const checks: DevCheck[] = [
    checkNodeVersion(process.version),
    checkCommandResult({
      id: "python",
      label: "Python",
      passMessage: "python is available.",
      failMessage: "python is not available",
      remediation: "Install Python 3.12 or newer, then rerun npm run setup.",
      result: run("python", ["--version"]),
    }),
    checkCommandResult({
      id: "kollabor-engine",
      label: "Kollabor engine package",
      passMessage: "kollabor_engine imports.",
      failMessage: "kollabor_engine is not installed",
      remediation: "Run npm run setup.",
      result: run("python", ["-c", "import kollabor_engine"]),
    }),
    checkPtyManager(),
  ];

  if (!preflight) {
    checks.push(await checkEngineHealth());
  }

  process.stdout.write(renderDoctorReport(checks));

  const summary = summarizeChecks(checks);
  process.exitCode = summary.ok ? 0 : 1;
}

void main();
