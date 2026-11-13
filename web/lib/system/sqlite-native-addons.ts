import {
  checkCommandResult,
  type CommandResult,
  type DevCheck,
} from "./dev-environment-checks";

export const SQLITE_ADDON_PACKAGES = [
  "better-sqlite3",
  "better-sqlite3-multiple-ciphers",
] as const;

const SQLITE_LOAD_SCRIPT = `try { for (const m of ${JSON.stringify(SQLITE_ADDON_PACKAGES)}) new (require(m))(":memory:").close(); } catch (e) { console.error(e.message.replace(/\\s+/g, " ")); process.exit(1); }`;

export type RunCommand = (
  command: string,
  commandArgs: string[],
  timeout?: number,
) => CommandResult;

export function checkSqliteNativeAddons(options: {
  run: RunCommand;
  executable: string;
  nodeVersion: string;
  preflight: boolean;
  onRebuild?: () => void;
}): DevCheck {
  const { run, executable, nodeVersion, preflight, onRebuild } = options;
  const packageNames = SQLITE_ADDON_PACKAGES.join(" ");
  const check = () =>
    checkCommandResult({
      id: "sqlite-addons",
      label: "SQLite native addons",
      passMessage: `${SQLITE_ADDON_PACKAGES.join(" and ")} load under Node ${nodeVersion}.`,
      failMessage: "SQLite native addons do not load",
      remediation: `Run npm rebuild ${packageNames}. On npm 12+, approve them first with npm install-scripts approve ${packageNames}.`,
      result: run(executable, ["-e", SQLITE_LOAD_SCRIPT]),
    });

  let result = check();
  if (result.status === "fail" && preflight) {
    onRebuild?.();
    run("npm", ["rebuild", ...SQLITE_ADDON_PACKAGES], 300_000);
    result = check();
  }

  return result;
}
