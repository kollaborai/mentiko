import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/lib/config";

type ProcessDefinition = {
  name: string;
  cmd: string;
  args?: string[];
  cwd?: string;
};

function readRepoFile(path: string): string {
  return readFileSync(join(config.codeRoot, path), "utf8");
}

function readProcesses(path: string): ProcessDefinition[] {
  return (JSON.parse(readRepoFile(path)) as { processes: ProcessDefinition[] }).processes;
}

describe("watcher/watchdog TypeScript ownership binding", () => {
  it("names only the typed watcher, typed watchdog, and background worker as active contract sources", () => {
    const contract = JSON.parse(readRepoFile(
      "docs/orchestration/contracts/watcher-watchdog.contract.json",
    )) as { source_files: string[] };

    expect(contract.source_files).toEqual([
      "web/lib/runner-v2/chain-watcher-service.ts",
      "web/lib/runner-v2/watchdog.ts",
      "web/server/background-worker.ts",
    ]);
  });

  it("launches the TypeScript background worker in development and its compiled JavaScript in production", () => {
    const devWorker = readProcesses("web/processes.dev.json")
      .find((process) => process.name === "worker");
    const productionWorker = readProcesses("web/processes.json")
      .find((process) => process.name === "worker");

    expect(devWorker).toMatchObject({
      cmd: "npx",
      args: ["tsx", "server/background-worker.ts"],
      cwd: ".",
    });
    expect(productionWorker).toMatchObject({
      cmd: "node",
      args: ["server/background-worker.js"],
      cwd: "/opt/mentiko",
    });
  });

  it("binds typed watcher start/status/stop and watchdog startup/periodic/status wiring in the worker", () => {
    const worker = readRepoFile("web/server/background-worker.ts");

    expect(worker).toContain("startChainWatcherService,");
    expect(worker).toContain("stopChainWatcherService,");
    expect(worker).toContain("getChainWatcherServiceStatus,");
    expect(worker).toContain("import { runTypedWatchdogScan }");

    expect(worker).toMatch(/const chainWatcher = getChainWatcherServiceStatus\(\);/);
    expect(worker).toMatch(/chainWatcher:\s*\{[\s\S]*status: chainWatcher\.status,[\s\S]*lastCheck: chainWatcher\.lastCheck,[\s\S]*lastError: chainWatcher\.lastError,/);
    expect(worker).toMatch(/watchdog:\s*\{[\s\S]*lastCheck: watchdogState\.lastCheck,[\s\S]*transportAvailable: watchdogState\.transportAvailable,[\s\S]*lastError: watchdogState\.lastError,/);

    expect(worker).toMatch(/startChainWatcherService\(\{[\s\S]*onFatalError:[\s\S]*shutdown\("chainWatcherFailure", 1\)/);
    expect(worker).toContain('shutdown("uncaughtException", 1)');
    expect(worker).toContain('shutdown("unhandledRejection", 1)');
    expect(worker).toContain('shutdown("startupFailure", 1)');
    expect(worker).toMatch(/await runWatchdog\("startup"\);/);
    expect(worker).toMatch(/watchdogInterval = setInterval\(\(\) => \{\s*void runWatchdog\("periodic"\);\s*\}, WATCHDOG_INTERVAL_MS\);/);
    expect(worker).toMatch(/await stopChainWatcherService\(\);/);
  });

  it("keeps every active launch surface free of retired shell-daemon commands and session names", () => {
    const activeLaunchSurfaces = [
      "bin/mentiko",
      "lib/chain-runner.sh",
      "web/lib/runs/chain-run-service.ts",
      "web/lib/runner-v2/bootstrap-executor.ts",
      "web/server/background-worker.ts",
      "web/processes.dev.json",
      "web/processes.json",
    ];
    const retiredLaunchTokens = [
      "lib/watchdog.sh",
      "lib/chain-event-watcher.sh",
      "mentiko-watchdog",
      "mentiko-chain-watcher",
    ];

    for (const path of activeLaunchSurfaces) {
      const source = readRepoFile(path);
      for (const token of retiredLaunchTokens) {
        expect({ path, token, present: source.includes(token) }).toEqual({
          path,
          token,
          present: false,
        });
      }
    }
  });
});
