import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildAgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/repo",
  },
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
    });
    expect(plan.instructionPath).toBe(join(runDir, "artifacts", "writer-instructions.md"));
    expect(plan.instructionPointer).toContain("You are Mentiko agent: writer.");
    expect(plan.profilePath).toBe(join(profilesDir, "stub-default.json"));
    expect(plan.localStartCommand).not.toContain("STUB_MODE");
    expect(plan.localStartCommand).toContain("build_profile_command");
    expect(plan.localStartCommand).toContain(join(profilesDir, "stub-default.json"));
    expect(plan.monitorCommand).toContain("monitor-chain-agent 'workspace-build-writer-run-123'");
    // the monitor must hand the runner-v2 flags to the completion session or
    // typed-launched runs silently fall back to shell completion.
    expect(plan.runContextExports).toMatchObject({
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
    });
    expect(plan.monitorCommand).toContain("export MENTIKO_RUNNER_V2='1'");
    expect(plan.monitorCommand).toContain("export MENTIKO_RUNNER_V2_COMPLETION='1'");
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
    expect(plan.localStartCommand).toContain("build_profile_command");
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
      cli: "claude",
    });
    writeJson(join(profilesDir, "namespace-profile.json"), {
      id: "namespace-profile",
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
    })).toThrow("requested agent profile 'missing-profile' was not found");
  });
});
