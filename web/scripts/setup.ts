import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import {
  getPtyManagerCandidates,
  getPtyManagerInstallScriptPath,
  parseEnvContent,
  upsertEnvContent,
  type PtyManagerCandidate,
} from "../lib/system/dev-environment-checks";

type StepResult = "changed" | "skipped";

const ENV_DEFAULTS: Record<string, string> = {
  BETTER_AUTH_SECRET: "dev-mode-secret-for-testing-only",
  INTERNAL_SERVICE_SECRET: "dev-internal-service-secret",
  MENTIKO_INBOX_KEY: "dev-mcp-smoke-key",
};
const PTY_MGR_REMOTE_INSTALLER =
  "curl -fsSL https://raw.githubusercontent.com/kollaborai/pty-mgr/main/install.sh | sh";

const envPath = join(process.cwd(), ".env.local");

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status === 0;
}

function commandSucceeds(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 10_000,
  });
  return result.status === 0;
}

function readEnvLocal(): string {
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
}

function ensureEnvLocalValues(values: Record<string, string>): StepResult {
  const existing = readEnvLocal();
  const next = upsertEnvContent(existing, values);
  if (!next.changed) return "skipped";
  writeFileSync(envPath, next.content);
  return "changed";
}

function ensureEnvLocal(): StepResult {
  return ensureEnvLocalValues(ENV_DEFAULTS);
}

function ensureKollaborEngine(): StepResult {
  if (commandSucceeds("python", ["-c", "import kollabor_engine"])) {
    return "skipped";
  }

  process.stdout.write(
    "\nInstalling kollabor-engine into the Python used by npm run dev...\n",
  );
  const installed = run("python", [
    "-m",
    "pip",
    "install",
    "--user",
    "kollabor-engine",
  ]);
  if (!installed || !commandSucceeds("python", ["-c", "import kollabor_engine"])) {
    process.stderr.write(
      "\nCould not install kollabor-engine automatically.\nTry: python -m pip install --user kollabor-engine\n",
    );
    process.exitCode = 1;
  }

  return "changed";
}

function ensurePtyManager(): StepResult {
  const env = {
    ...parseEnvContent(readEnvLocal()),
    ...process.env,
  };
  const candidates = getPtyManagerCandidates({ env });
  const directCandidates = candidates.filter(
    (candidate) => candidate.source !== "repo-wrapper",
  );

  for (const candidate of directCandidates) {
    if (!commandSucceeds(candidate.path, ["--help"])) continue;
    return recordPtyCandidate(candidate);
  }

  const installScript = getPtyManagerInstallScriptPath();
  const installCommand = existsSync(installScript)
    ? { label: "../pty-mgr/install.sh", command: "sh", args: [installScript] }
    : {
        label: "the pty-mgr GitHub installer",
        command: "sh",
        args: ["-c", PTY_MGR_REMOTE_INSTALLER],
      };

  process.stdout.write(`\nInstalling pty-mgr with ${installCommand.label}...\n`);
  if (run(installCommand.command, installCommand.args)) {
    const installed = getPtyManagerCandidates({
      env: {
        ...env,
        ...parseEnvContent(readEnvLocal()),
      },
    }).find((candidate) => candidate.source === "installed");

    if (installed && commandSucceeds(installed.path, ["--help"])) {
      return recordPtyCandidate(installed);
    }
  }

  process.stderr.write(
    `\nCould not install pty-mgr automatically with ${installCommand.label}.\n`,
  );

  const wrapper = candidates.find((candidate) => candidate.source === "repo-wrapper");
  if (wrapper && commandSucceeds(wrapper.path, ["--help"])) {
    process.stderr.write(
      "\nUsing the repo pty-mgr wrapper fallback. Build or install pty-mgr for the native binary path.\n",
    );
    return "skipped";
  }

  process.stderr.write(
    "\nCould not find a usable pty-mgr binary.\nBuild ../pty-mgr with npm run build, run ../pty-mgr/install.sh, or set MENTIKO_PTY_MGR_BIN.\n",
  );
  process.exitCode = 1;
  return "skipped";
}

function recordPtyCandidate(candidate: PtyManagerCandidate): StepResult {
  if (candidate.source === "env") return "skipped";
  return ensureEnvLocalValues({
    MENTIKO_PTY_MGR_BIN: candidate.path,
  });
}

process.stdout.write("Mentiko local setup\n\n");

const envResult = ensureEnvLocal();
process.stdout.write(
  `${envResult === "changed" ? "Updated" : "Kept"} web/.env.local development defaults.\n`,
);

const engineResult = ensureKollaborEngine();
process.stdout.write(
  `${engineResult === "changed" ? "Installed" : "Found"} kollabor-engine.\n`,
);

const ptyResult = ensurePtyManager();
process.stdout.write(
  `${ptyResult === "changed" ? "Prepared" : "Found"} PTY manager.\n`,
);

process.stdout.write("\nRun npm run doctor to verify the local environment.\n");
