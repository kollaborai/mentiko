import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildAgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/repo",
    eventsDir: "/project/events",
    stateDir: "/project/state",
    orgRoot: "/tmp/runner-v2-config-org",
    agentProfilesDir: "/tmp/runner-v2-config-org/agent-profiles",
  },
  ptyDaemonEnv: () => ({ PTY_DAEMON: "mentiko-test", PTY_MANAGER_DIR: "/repo/.pty-manager" }),
}));

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-bootstrap-plan-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("runner-v2 agent bootstrap plan", () => {
  it("plans local profile-backed bootstrap context for the selected first agent", () => {
    const root = tempDir();
    const runDir = join(root, "runs", "run-123");
    const profilesDir = join(root, "profiles");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });
    const chainPath = join(runDir, "chain.json");
    writeJson(join(profilesDir, "stub-default.json"), {
      id: "stub-default",
      name: "Stub Default",
      cli: "/tmp/stub-cli",
      env: { STUB_MODE: "complete" },
    });
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      default_agent_profile: "stub-default",
      config: {
        project_root: join(root, "workspace"),
        session_prefix: "build",
        monitor_interval: 1,
      },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready", triggers: ["manual-start"] },
      ],
    });

    const plan = buildAgentBootstrapPlan({
      chainPath,
      runDir,
      runId: "run-123",
      env: {
        AGENT_PROFILES_DIR: profilesDir,
        MENTIKO_PROJECT_ROOT: join(root, "workspace"),
        EVENTS_DIR: join(root, "events"),
        STATE_DIR: join(root, "state"),
        PATH: "/bin",
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      },
    });

    expect(plan).toMatchObject({
      agentId: "writer",
      agentName: "Writer",
      sessionPrefix: "build-writer",
      sessionName: "workspace-build-writer-run-123",
      monitorSessionName: "monitor-workspace-build-writer-run-123",
      profileId: "stub-default",
    });
    expect(plan.runContextExports).toMatchObject({
      PATH: "/repo/bin:/bin",
      MENTIKO_BIN: "/repo/bin/mentiko",
      MENTIKO_RUN_ID: "run-123",
      MENTIKO_RUN_DIR: runDir,
      MENTIKO_AGENT_ID: "writer",
      MENTIKO_AGENT_EMITS: "draft-ready",
      EVENTS_DIR: join(root, "events"),
      ARTIFACTS_DIR: join(runDir, "artifacts"),
      AGENT_PROFILES_DIR: profilesDir,
    });
    expect(plan.instructionPath).toBe(join(runDir, "artifacts", "writer-instructions.md"));
    expect(plan.instructionPointer).toContain("You are Mentiko agent: writer.");
    expect(plan.profilePath).toBe(join(profilesDir, "stub-default.json"));
    expect(plan.localStartCommand).not.toContain("STUB_MODE");
    expect(plan.localStartCommand).toContain("runner-agent-profile.js' command");
    expect(plan.localStartCommand).toContain(join(profilesDir, "stub-default.json"));
    // The monitor receives the typed completion launch context.
    expect(plan.runContextExports).toMatchObject({
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
    });
    expect(plan.monitorCommand).toContain("export MENTIKO_RUNNER_V2='1'");
    expect(plan.monitorCommand).toContain("export MENTIKO_RUNNER_V2_COMPLETION='1'");
    expect(plan.monitorCommand).toContain(`export AGENT_PROFILES_DIR='${profilesDir}'`);
    expect(plan.monitorCommand).toContain("exec node '/repo/lib/monitor-v2.js'");
    expect(plan.monitorCommand).not.toContain("monitor-chain-agent");
  });

  it("emits the compiled typed monitor command without a shell compatibility route", () => {
    const root = tempDir();
    const runDir = join(root, "runs", "run-monitor");
    mkdirSync(runDir, { recursive: true });
    const chainPath = join(runDir, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: join(root, "workspace"), monitor_interval: 2 },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready", triggers: ["manual-start"] },
      ],
    });

    const plan = buildAgentBootstrapPlan({
      chainPath,
      runDir,
      runId: "run-monitor",
      env: {
        PATH: "/bin",
        MENTIKO_PROJECT_ROOT: join(root, "workspace"),
      },
    });

    expect(plan.monitorCommand).toContain("node '/repo/lib/monitor-v2.js'");
    expect(plan.monitorCommand).toContain("'workspace-writer-run-monitor' '2'");
    expect(plan.monitorCommand).not.toContain("npx tsx");
    expect(plan.monitorCommand).not.toContain("monitor-chain-agent");
  });

  it("does not inline profile secrets into the terminal command", () => {
    const root = tempDir();
    const runDir = join(root, "runs", "run-secret");
    const profilesDir = join(root, "profiles");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });
    const chainPath = join(runDir, "chain.json");
    writeJson(join(profilesDir, "secret-profile.json"), {
      id: "secret-profile",
      name: "Secret Profile",
      cli: "claude",
      env: {
        ANTHROPIC_API_KEY: "{secret:ANTHROPIC_API_KEY}",
        VISIBLE: "do-not-inline",
      },
    });
    writeJson(chainPath, {
      default_agent_profile: "secret-profile",
      agents: [{ id: "writer", triggers: ["manual-start"] }],
    });

    const plan = buildAgentBootstrapPlan({
      chainPath,
      runDir,
      runId: "run-secret",
      env: {
        AGENT_PROFILES_DIR: profilesDir,
        PATH: "/bin",
      },
    });

    expect(plan.localStartCommand).not.toContain("ANTHROPIC_API_KEY");
    expect(plan.localStartCommand).not.toContain("{secret:ANTHROPIC_API_KEY}");
    expect(plan.localStartCommand).not.toContain("do-not-inline");
    expect(plan.localStartCommand).toContain("runner-agent-profile.js' command");
  });

  it("resolves profile fallback through workspace and namespace defaults", () => {
    const root = tempDir();
    const runDir = join(root, "runs", "run-workspace");
    const orgRoot = join(root, "org");
    const profilesDir = join(orgRoot, "agent-profiles");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });
    const chainPath = join(runDir, "chain.json");
    writeJson(join(profilesDir, "workspace-profile.json"), {
      id: "workspace-profile",
      name: "Workspace Profile",
      cli: "claude",
    });
    writeJson(join(profilesDir, "namespace-profile.json"), {
      id: "namespace-profile",
      name: "Namespace Profile",
      cli: "claude",
      isDefault: true,
    });
    writeJson(join(orgRoot, "workspaces.json"), [
      { path: workspaceRoot, default_agent_profile: "workspace-profile" },
    ]);
    writeJson(chainPath, {
      agents: [{ id: "writer", triggers: ["manual-start"] }],
    });

    const plan = buildAgentBootstrapPlan({
      chainPath,
      runDir,
      runId: "run-workspace",
      workspacePath: workspaceRoot,
      env: {
        MENTIKO_ORG_ROOT: orgRoot,
        PATH: "/bin",
      },
    });

    expect(plan.profileId).toBe("workspace-profile");
    expect(plan.profilePath).toBe(join(profilesDir, "workspace-profile.json"));
    expect(plan.runContextExports.MENTIKO_AGENT_PROFILE_PATH).toBe(join(profilesDir, "workspace-profile.json"));
  });

  it("uses the configured canonical profile root for direct typed launches without an injected org root", () => {
    const root = tempDir();
    const runDir = join(root, "runs", "run-direct-profile");
    const profilesDir = "/tmp/runner-v2-config-org/agent-profiles";
    mkdirSync(runDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });
    const chainPath = join(runDir, "chain.json");
    writeJson(join(profilesDir, "direct-profile.json"), {
      id: "direct-profile",
      name: "Direct Profile",
      cli: "node",
    });
    writeJson(chainPath, {
      default_agent_profile: "direct-profile",
      agents: [{ id: "writer", triggers: ["manual-start"] }],
    });

    const plan = buildAgentBootstrapPlan({
      chainPath,
      runDir,
      runId: "run-direct-profile",
      env: { PATH: "/bin" },
    });

    expect(plan.profileId).toBe("direct-profile");
    expect(plan.profilePath).toBe(join(profilesDir, "direct-profile.json"));
    expect(plan.runContextExports.MENTIKO_AGENT_PROFILE_PATH).toBe(join(profilesDir, "direct-profile.json"));
  });

  it("fails when a requested profile is missing and no valid fallback exists", () => {
    const root = tempDir();
    const runDir = join(root, "runs", "run-missing");
    const profilesDir = join(root, "profiles");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });
    const chainPath = join(runDir, "chain.json");
    writeJson(chainPath, {
      default_agent_profile: "missing-profile",
      agents: [{ id: "writer", triggers: ["manual-start"] }],
    });

    expect(() => buildAgentBootstrapPlan({
      chainPath,
      runDir,
      runId: "run-missing",
      env: {
        AGENT_PROFILES_DIR: profilesDir,
        PATH: "/bin",
      },
    })).toThrow("Agent profile 'missing-profile' does not exist");
  });
});
