import { readFileSync } from "fs";
import { join } from "path";
import type { ReadinessConfig, RestartConfig } from "../pm-types";
import {
  formatReadinessTimeout,
  resolveReadinessTimeout,
  resolveRestartDelay,
} from "../process-manager-readiness";

interface ConfiguredProcess {
  name: string;
  readiness: ReadinessConfig;
  restart: RestartConfig;
}

function devProcess(name: string): ConfiguredProcess {
  const config = JSON.parse(readFileSync(join(process.cwd(), "processes.dev.json"), "utf8")) as {
    processes: ConfiguredProcess[];
  };
  const configured = config.processes.find((candidate) => candidate.name === name);
  if (!configured) throw new Error(`Missing dev process config for ${name}`);
  return configured;
}

describe("process-manager readiness policy", () => {
  it("gives cold dev starts longer, configurable windows for ws-terminal and the engine", () => {
    const terminal = devProcess("ws-terminal");
    const engine = devProcess("kollabor-engine");

    expect(terminal.readiness).toMatchObject({
      type: "port",
      port: 3099,
      timeout: 30_000,
      timeoutEnv: "MENTIKO_WS_TERMINAL_READINESS_TIMEOUT_MS",
    });
    expect(engine.readiness).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:7443/health",
      timeout: 30_000,
      timeoutEnv: "MENTIKO_KOLLAB_ENGINE_READINESS_TIMEOUT_MS",
    });
    expect(resolveReadinessTimeout(terminal.readiness, {})).toBe(30_000);
    expect(resolveReadinessTimeout(engine.readiness, {})).toBe(30_000);
    expect(resolveReadinessTimeout(terminal.readiness, {
      MENTIKO_WS_TERMINAL_READINESS_TIMEOUT_MS: "60000",
    })).toBe(60_000);
    expect(resolveReadinessTimeout(engine.readiness, {
      MENTIKO_KOLLAB_ENGINE_READINESS_TIMEOUT_MS: "not-a-number",
    })).toBe(30_000);
  });

  it("logs the probe target and effective deadline on timeout", () => {
    const terminal = devProcess("ws-terminal");
    const engine = devProcess("kollabor-engine");

    expect(formatReadinessTimeout(terminal.name, terminal.readiness, 45_000)).toBe(
      "ws-terminal readiness timeout after 45000ms (port 3099), killing",
    );
    expect(formatReadinessTimeout(engine.name, engine.readiness, 30_000)).toBe(
      "kollabor-engine readiness timeout after 30000ms (HTTP http://127.0.0.1:7443/health), killing",
    );
  });

  it("uses bounded exponential backoff and retries critical readiness during startup", () => {
    const terminal = devProcess("ws-terminal");
    const engine = devProcess("kollabor-engine");

    expect(terminal.restart.retryOnStartup).toBe(true);
    expect(resolveRestartDelay(terminal.restart, 0, () => 0.5)).toEqual({ delayMs: 1000, maxRestarts: 5 });
    expect(resolveRestartDelay(terminal.restart, 1, () => 0.5)).toEqual({ delayMs: 2000, maxRestarts: 5 });
    expect(resolveRestartDelay(terminal.restart, 5, () => 0.5)).toBeNull();

    expect(resolveRestartDelay(engine.restart, 0, () => 0.5)).toEqual({ delayMs: 2000, maxRestarts: 3 });
    expect(resolveRestartDelay(engine.restart, 1, () => 0.5)).toEqual({ delayMs: 4000, maxRestarts: 3 });

    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");
    expect(source).toContain("config.restart?.retryOnStartup");
    expect(source).toContain("return startOne(config, options)");
  });
});
