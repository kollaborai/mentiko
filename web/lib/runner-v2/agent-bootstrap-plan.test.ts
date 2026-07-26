import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildAgentBootstrapPlan, extractAcceptanceCriteria } from "@/lib/runner-v2/agent-bootstrap-plan";

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
        MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
        MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:3200/api/ai-gateway/local/v1",
        MENTIKO_AI_GATEWAY_LOCAL_TOKEN: "internal-proxy-token",
        ANTHROPIC_API_KEY: "must-not-reach-pty",
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
      MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:3200/api/ai-gateway/local/v1",
      MENTIKO_AI_GATEWAY_LOCAL_TOKEN: "internal-proxy-token",
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
    expect(plan.monitorCommand).toContain("MENTIKO_AI_GATEWAY_LOCAL_TOKEN='internal-proxy-token'");
    expect(plan.monitorCommand).not.toContain("ANTHROPIC_API_KEY");
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

  // These pin behavior that previously existed ONLY inside the committed lib/*.js
  // bundles with no .ts source, so `node scripts/build-runner-bundles.mjs` deleted it
  // with no reviewable diff. Without these tests the next rebuild deletes it again.
  describe("task context exports", () => {
    type ChainSpec = Record<string, unknown> | ((root: string) => Record<string, unknown>);

    function planWith(chain: ChainSpec, env: Record<string, string> = {}) {
      const root = tempDir();
      const runDir = join(root, "runs", "run-ctx");
      const profilesDir = join(root, "profiles");
      mkdirSync(runDir, { recursive: true });
      mkdirSync(profilesDir, { recursive: true });
      writeJson(join(profilesDir, "stub-default.json"), { id: "stub-default", name: "Stub", cli: "/tmp/stub-cli" });
      const chainPath = join(runDir, "chain.json");
      // The temp root is created here, so a chain needing a path under it passes a
      // function instead of an object literal.
      writeJson(chainPath, { default_agent_profile: "stub-default", ...(typeof chain === "function" ? chain(root) : chain) });
      const plan = buildAgentBootstrapPlan({
        chainPath,
        runDir,
        runId: "run-ctx",
        env: { AGENT_PROFILES_DIR: profilesDir, PATH: "/bin", ...env },
      });
      return { plan, runDir, root };
    }

    it("populates TASK_CONTEXT with resolved run identity instead of an empty string", () => {
      const { plan, runDir, root } = planWith((chainRoot) => ({
        id: "build-chain",
        name: "Build Chain",
        description: "ship the thing",
        metadata: { implementationFocus: "runner", taskId: "TASK-500" },
        config: { project_root: join(chainRoot, "workspace"), session_prefix: "build" },
        agents: [{ id: "writer", name: "Writer", role: "author", triggers: ["manual-start"] }],
      }));

      expect(plan.runContextExports.TASK_CONTEXT).not.toBe("");
      const context = JSON.parse(plan.runContextExports.TASK_CONTEXT);
      expect(context).toMatchObject({
        RUN_ID: "run-ctx",
        AGENT_ID: "writer",
        CHAIN_ID: "build-chain",
        TASK_ID: "TASK-500",
        CHAIN_NAME: "Build Chain",
        CHAIN_DESCRIPTION: "ship the thing",
        AGENT_NAME: "Writer",
        AGENT_ROLE: "author",
        CHAIN_OBJECTIVE: "ship the thing",
        IMPLEMENTATION_FOCUS: "runner",
        SESSION_PREFIX: "build",
      });
      // The bundle-only version read these from process.env, which is empty on a
      // direct CLI launch — the exact case this branch fixes. They must be resolved.
      expect(context.ARTIFACTS_DIR).toBe(join(runDir, "artifacts"));
      expect(context.EVENTS_DIR).toBe("/project/events");
      expect(context.WORKSPACE_PATH).toBe(join(root, "workspace"));
    });

    it("lets a caller-supplied TASK_CONTEXT win over the derived blob", () => {
      const { plan } = planWith(
        { agents: [{ id: "writer", triggers: ["manual-start"] }] },
        { TASK_CONTEXT: "explicit context" },
      );
      expect(plan.runContextExports.TASK_CONTEXT).toBe("explicit context");
    });

    it("keeps TASK_ID identical in the export and the context blob", () => {
      // The bundle version consulted agent.taskId for the export but not the blob,
      // so an agent-level id appeared in one and was missing from the other.
      const { plan } = planWith({
        agents: [{ id: "writer", taskId: "TASK-AGENT", triggers: ["manual-start"] }],
      });
      expect(plan.runContextExports.TASK_ID).toBe("TASK-AGENT");
      expect(JSON.parse(plan.runContextExports.TASK_CONTEXT).TASK_ID).toBe("TASK-AGENT");
    });

    it("resolves acceptance criteria agent -> chain metadata -> generated contract", () => {
      const agentLevel = { id: "writer", acceptance_criteria: "from agent" };
      expect(extractAcceptanceCriteria({ metadata: { acceptanceCriteria: "from chain" } }, agentLevel))
        .toBe("from agent");
      expect(extractAcceptanceCriteria({ metadata: { acceptanceCriteria: "from chain" } }, { id: "writer" }))
        .toBe("from chain");
      expect(extractAcceptanceCriteria(
        { metadata: { generated_chain_contract: { acceptance_criteria: "from contract" } } },
        { id: "writer" },
      )).toBe("from contract");
      expect(extractAcceptanceCriteria({}, { id: "writer" })).toBe("");
      // An array-valued contract must not be indexed as an object.
      expect(extractAcceptanceCriteria({ metadata: { generated_chain_contract: ["nope"] } }, { id: "writer" }))
        .toBe("");
    });

    it("exports the resolved acceptance criteria to the agent env", () => {
      const { plan } = planWith({
        metadata: { acceptanceCriteria: "the postcondition holds" },
        agents: [{ id: "writer", triggers: ["manual-start"] }],
      });
      expect(plan.runContextExports.TASK_ACCEPTANCE_CRITERIA).toBe("the postcondition holds");
    });
  });
});
