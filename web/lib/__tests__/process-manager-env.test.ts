import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  buildManagedProcessEnv,
  expandManagedProcessArgs,
  MANAGED_PROCESS_ENV_WHITELIST,
  PLATFORM_PROCESS_ENV_WHITELIST,
  resolveManagedDevGlobalRoot,
  resolveManagedDevMcpShim,
  resolveManagedWebPort,
  shouldReplaceUnavailableDevContainerRoot,
} from "../process-manager-env";
import type { ProcessesFile } from "../pm-types";
import { RUNNER_CONTROL_ENV_KEYS } from "../runner-control-env";

describe("process manager environment", () => {
  it("uses the config.ts local root only when no explicit managed root exists", () => {
    expect(resolveManagedDevGlobalRoot({}, "/Users/marco")).toBe("/Users/marco/.mentiko");
    expect(resolveManagedDevGlobalRoot({ MENTIKO_ROOT: "/legacy-root" }, "/Users/marco")).toBe("/legacy-root");
    expect(resolveManagedDevGlobalRoot({ MENTIKO_GLOBAL_ROOT: "/explicit-root", MENTIKO_ROOT: "/legacy-root" }, "/Users/marco")).toBe("/explicit-root");
  });

  it("resolves the dev MCP shim from the repository root", () => {
    const shim = resolveManagedDevMcpShim(process.cwd());
    const repoRootShim = join(process.cwd(), "..", "bin", "mentiko-mcp");

    expect(shim).toBe(repoRootShim);
    expect(existsSync(shim)).toBe(true);
    expect(existsSync(join(process.cwd(), "bin", "mentiko-mcp"))).toBe(false);

    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");
    expect(source).toContain("resolveManagedDevMcpShim(process.cwd())");
  });

  it("replaces only a nonexistent inherited container root during local dev", () => {
    expect(shouldReplaceUnavailableDevContainerRoot({ MENTIKO_GLOBAL_ROOT: "/app" }, false)).toBe(true);
    expect(shouldReplaceUnavailableDevContainerRoot({ MENTIKO_GLOBAL_ROOT: "/app" }, true)).toBe(false);
    expect(shouldReplaceUnavailableDevContainerRoot({ MENTIKO_GLOBAL_ROOT: "/explicit-root" }, false)).toBe(false);
  });

  it("expands the configured daemon argument from the same env used by readiness", () => {
    const sourceEnv = { PTY_DAEMON: "mentiko-local-default" };
    expect(expandManagedProcessArgs(["daemon", "@$PTY_DAEMON"], sourceEnv)).toEqual([
      "daemon",
      "@mentiko-local-default",
    ]);

    const processes = JSON.parse(readFileSync(join(process.cwd(), "processes.dev.json"), "utf8"));
    const pty = processes.processes.find((process: { name: string }) => process.name === "pty-mgr");
    expect(pty.args).toEqual(["daemon", "@$PTY_DAEMON"]);
  });

  it("uses the configured platform port before stamping the default into the supervisor env", () => {
    const dev = JSON.parse(readFileSync(join(__dirname, "..", "..", "processes.dev.json"), "utf8"));
    const platform = dev.processes.find((process: { name: string }) => process.name === "platform");
    const webPort = resolveManagedWebPort({}, platform);

    expect(webPort).toBe("3200");
    expect(resolveManagedWebPort({ PORT: "3211" }, platform)).toBe("3211");
    expect(resolveManagedWebPort({ WEB_PORT: "3212" }, platform)).toBe("3212");
    expect(buildManagedProcessEnv(platform, { PORT: webPort, WEB_PORT: webPort }).PORT).toBe("3200");

    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");
    expect(source).toContain("resolveManagedWebPort(process.env, platformConfig)");
    const configLoadAt = source.indexOf("const config = loadConfig(configPath)");
    const housekeepAt = source.indexOf("await housekeep(config)");
    expect(configLoadAt).toBeGreaterThanOrEqual(0);
    expect(housekeepAt).toBeGreaterThan(configLoadAt);
  });

  it("hands KOLLAB_CONFIG_DIR only to the web app and the engine", () => {
    const src = { KOLLAB_CONFIG_DIR: "/tmp/mentiko-kollab", PATH: "/bin" };
    const dev: ProcessesFile = JSON.parse(readFileSync(join(__dirname, "..", "..", "processes.dev.json"), "utf8"));
    const procs = dev.processes;
    const envFor = (name: string) =>
      buildManagedProcessEnv(procs.find((p) => p.name === name)!, src).KOLLAB_CONFIG_DIR;
    expect(envFor("platform")).toBe("/tmp/mentiko-kollab");
    expect(envFor("kollabor-engine")).toBe("/tmp/mentiko-kollab");
    expect(envFor("pty-mgr")).toBeUndefined();
    expect(envFor("worker")).toBeUndefined();
  });

  it("passes pty manager override variables to managed child processes", () => {
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("PTY_MGR_BIN");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("MENTIKO_PTY_MGR_BIN");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("PTY_DAEMON");
  });

  it("passes every runner control to both production server processes", () => {
    const sourceEnv = Object.fromEntries(
      RUNNER_CONTROL_ENV_KEYS.map((key) => [key, key === "MENTIKO_MAX_ACTIVE_AGENTS" ? "1" : "test-value"]),
    );

    for (const name of ["platform", "worker"]) {
      const managed = buildManagedProcessEnv({ name, env: {} }, sourceEnv);
      for (const key of RUNNER_CONTROL_ENV_KEYS) {
        expect(managed[key]).toBe(sourceEnv[key]);
      }
      expect(managed.MENTIKO_MAX_ACTIVE_AGENTS).toBe("1");
    }

    const dockerfile = readFileSync(join(process.cwd(), "..", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("cp /tmp/pm-out/runner-control-env.js /context/lib/runner-control-env.js");
  });

  it("loads the web-local env file and assigns the typed dev root before spawning managed children", () => {
    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");

    expect(source).toContain("path.join(process.cwd(), '.env.local')");
    expect(source).toContain("resolveManagedDevGlobalRoot(rootEnvironment, home)");
    expect(source).toContain("shouldReplaceUnavailableDevContainerRoot(");
    expect(source).toContain("expandManagedProcessArgs(config.args || [], process.env)");
  });

  it("passes tenant transactional email variables to managed child processes", () => {
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_HOST");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_PORT");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_FROM");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_USER");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("SMTP_PASS");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("RESEND_API_KEY");
    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("EMAIL_FROM");
  });

  it("passes tenant AI gateway variables only to managed Next.js", () => {
    const sourceEnv = {
      TENANT_ID: "tenant-1",
      MENTIKO_AI_GATEWAY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_URL: "https://ai.mentiko.com/v1",
      MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN: "https://ai.mentiko.com",
      MENTIKO_AI_GATEWAY_TOKEN_ID: "tok_test",
      MENTIKO_AI_GATEWAY_TOKEN: "secret-gateway-token",
    };

    const platformEnv = buildManagedProcessEnv({ name: "platform", env: {} }, sourceEnv);
    const workerEnv = buildManagedProcessEnv({ name: "worker", env: {} }, sourceEnv);

    expect(MANAGED_PROCESS_ENV_WHITELIST).toContain("TENANT_ID");
    expect(PLATFORM_PROCESS_ENV_WHITELIST).toContain("MENTIKO_AI_GATEWAY_TOKEN");
    expect(MANAGED_PROCESS_ENV_WHITELIST).not.toContain("MENTIKO_AI_GATEWAY_TOKEN");

    expect(platformEnv.TENANT_ID).toBe("tenant-1");
    expect(platformEnv.MENTIKO_AI_GATEWAY_ENABLED).toBe("true");
    expect(platformEnv.MENTIKO_AI_GATEWAY_URL).toBe("https://ai.mentiko.com/v1");
    expect(platformEnv.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN).toBe("https://ai.mentiko.com");
    expect(platformEnv.MENTIKO_AI_GATEWAY_TOKEN_ID).toBe("tok_test");
    expect(platformEnv.MENTIKO_AI_GATEWAY_TOKEN).toBe("secret-gateway-token");

    expect(workerEnv.TENANT_ID).toBe("tenant-1");
    expect(workerEnv.MENTIKO_AI_GATEWAY_ENABLED).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_URL).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_TOKEN_ID).toBeUndefined();
    expect(workerEnv.MENTIKO_AI_GATEWAY_TOKEN).toBeUndefined();
  });
});
