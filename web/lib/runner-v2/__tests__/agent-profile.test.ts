import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAgentProfileCommand, resolveAgentProfile } from "@/lib/runner-v2/agent-profile";

jest.mock("@/lib/secrets/secrets-store", () => ({
  getSecretByName: jest.fn((_namespaceId: string, _orgId: string, name: string) => name === "AVAILABLE" ? "resolved-secret" : null),
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-agent-profile-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("runner-v2 agent profile contract", () => {
  it("resolves the documented priority through typed paths", () => {
    const root = tempDir();
    const orgRoot = join(root, "org");
    const profilesDir = join(orgRoot, "agent-profiles");
    const workspace = join(root, "workspace");
    const chainPath = join(root, "chain.json");
    mkdirSync(profilesDir, { recursive: true });
    writeJson(join(profilesDir, "namespace.json"), { id: "namespace", name: "Namespace", cli: "claude", isDefault: true });
    writeJson(join(profilesDir, "workspace.json"), { id: "workspace", name: "Workspace", cli: "codex" });
    writeJson(join(profilesDir, "chain.json"), { id: "chain", name: "Chain", cli: "kollab" });
    writeJson(join(profilesDir, "agent.json"), { id: "agent", name: "Agent", cli: "agy" });
    writeJson(join(orgRoot, "workspaces.json"), [{ path: workspace, default_agent_profile: "workspace" }]);
    writeJson(chainPath, {
      default_agent_profile: "chain",
      agents: [{ id: "writer", agent_profile: "agent" }],
    });

    const resolved = resolveAgentProfile({ chainPath, agentId: "writer", projectRoot: workspace, profilesDir, orgRoot });
    expect(resolved).toMatchObject({ id: "agent", source: "agent", path: join(profilesDir, "agent.json") });
  });

  it("fails closed when an explicitly selected profile is absent instead of selecting a lower-priority default", () => {
    const root = tempDir();
    const profilesDir = join(root, "profiles");
    const chainPath = join(root, "chain.json");
    mkdirSync(profilesDir, { recursive: true });
    writeJson(join(profilesDir, "namespace.json"), { id: "namespace", name: "Namespace", cli: "claude", isDefault: true });
    writeJson(chainPath, { default_agent_profile: "missing", agents: [{ id: "writer" }] });

    expect(() => resolveAgentProfile({ chainPath, agentId: "writer", profilesDir })).toThrow("Agent profile 'missing' does not exist");
  });

  it("builds a command without leaking unresolved secret references and preserves resolved values only in a private env file", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, {
      id: "profile",
      name: "Profile",
      cli: "claude",
      permission_flag: "--dangerously-skip-permissions",
      env: { AVAILABLE: "{secret:AVAILABLE}", MISSING: "{secret:MISSING}", PLAIN: "visible-only-in-file" },
      extra_args: ["--flag", "value with spaces"],
    });

    const command = buildClaudeProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" });
    expect(command).toContain("'--dangerously-skip-permissions'");
    expect(command).not.toContain("'--allow-dangerously-skip-permissions'");
    expect(command).not.toContain("'--permission-mode' 'bypassPermissions'");
    expect(command).not.toContain("{secret:");
    expect(command).not.toContain("resolved-secret");
    expect(command).not.toContain("visible-only-in-file");
    const envFile = command.match(/source '([^']+)'/)?.[1];
    expect(envFile).toBeDefined();
    const env = readFileSync(envFile!, "utf8");
    expect(env).toContain("export AVAILABLE='resolved-secret'");
    expect(env).toContain("export PLAIN='visible-only-in-file'");
    expect(env).not.toContain("MISSING");
  });

  it("renders each configured permission flag as its own quoted argv token", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, {
      id: "profile",
      name: "Profile",
      cli: "claude",
      permission_flag: '--permission-mode bypassPermissions --add-dir "/tmp/path with spaces"',
    });

    expect(buildClaudeProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" }))
      .toContain("'--permission-mode' 'bypassPermissions' '--add-dir' '/tmp/path with spaces'");
  });

  it("uses a private, run-scoped Mentiko MCP config for Claude instead of user config", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    const previous = {
      MENTIKO_WEB_URL: process.env.MENTIKO_WEB_URL,
      MENTIKO_SESSION_ID: process.env.MENTIKO_SESSION_ID,
      MENTIKO_SESSION_TOKEN: process.env.MENTIKO_SESSION_TOKEN,
      MENTIKO_CODE_ROOT: process.env.MENTIKO_CODE_ROOT,
    };
    Object.assign(process.env, {
      MENTIKO_WEB_URL: "http://127.0.0.1:3200",
      MENTIKO_SESSION_ID: "chain-run-123",
      MENTIKO_SESSION_TOKEN: "run-token",
      MENTIKO_CODE_ROOT: join(process.cwd(), ".."),
    });
    let configPath: string | undefined;
    try {
      writeJson(profilePath, { id: "profile", name: "Profile", cli: "claude" });
      const command = buildAgentProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" });
      expect(command).toContain("'--mcp-config'");
      expect(command).toContain("'--strict-mcp-config'");
      expect(command).toContain("mentiko-claude-mcp-");
      expect(command).not.toContain("run-token");
      configPath = command.match(/--mcp-config' '([^']+)'/)?.[1];
    } finally {
      if (configPath) rmSync(configPath, { force: true });
      if (configPath) rmdirSync(dirname(configPath));
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("renders each non-interactive pipe flag as its own quoted argv token", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, {
      id: "profile",
      name: "Profile",
      cli: "claude",
      pipe_flag: '-p --add-dir "/tmp/path with spaces"',
    });

    expect(buildClaudeProfileCommand({ profilePath, interactive: false, namespaceId: "default", orgId: "default" }))
      .toContain("'claude' '-p' '--add-dir' '/tmp/path with spaces'");
  });

  it("rejects malformed permission argument fragments instead of handing them to the CLI", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, {
      id: "profile",
      name: "Profile",
      cli: "claude",
      permission_flag: '--permission-mode "bypassPermissions',
    });

    expect(() => buildAgentProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" }))
      .toThrow("Invalid permission_flag");
  });

  it("rejects malformed non-interactive pipe fragments instead of handing them to the CLI", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, {
      id: "profile",
      name: "Profile",
      cli: "claude",
      pipe_flag: '--add-dir "/tmp/path with spaces',
    });

    expect(() => buildAgentProfileCommand({ profilePath, interactive: false, namespaceId: "default", orgId: "default" }))
      .toThrow("Invalid pipe_flag");
  });

  it("builds interactive Codex TUI and noninteractive exec invocations with isolated trusted CODEX_HOME", () => {
    const root = tempDir();
    const profilePath = join(root, "codex.json");
    writeJson(profilePath, {
      id: "codex",
      name: "Codex",
      cli: "codex",
      pipe_flag: "exec",
      model: "gpt-5.6-sol",
      permission_flag: "--dangerously-bypass-approvals-and-sandbox",
    });

    const interactive = buildAgentProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" });
    const noninteractive = buildAgentProfileCommand({ profilePath, interactive: false, namespaceId: "default", orgId: "default" });
    expect(interactive).toContain("'codex' '-c' 'check_for_update_on_startup=false' '--dangerously-bypass-hook-trust'");
    expect(interactive).not.toContain("'codex' 'exec'");
    expect(noninteractive).toContain("'codex' 'exec' '-c' 'check_for_update_on_startup=false' '--dangerously-bypass-hook-trust'");
    expect(interactive.match(/(?:^|[ ;])'exec'/g)?.length ?? 0).toBe(0);
    expect(noninteractive.match(/(?:^|[ ;])'exec'/g)?.length ?? 0).toBe(1);
    for (const command of [interactive, noninteractive]) {
      expect(command).toContain('MENTIKO_CODEX_AUTH_HOME="${CODEX_HOME:-$HOME/.codex}"');
      expect(command).toContain('CODEX_HOME="$(mktemp -d');
      expect(command).toContain("export CODEX_HOME");
      expect(command).toContain("cp \"$MENTIKO_CODEX_AUTH_HOME/auth.json\" \"$CODEX_HOME/auth.json\"");
      expect(command).toContain("chmod 600 \"$CODEX_HOME/auth.json\"");
      expect(command).toContain("check_for_update_on_startup = false");
      expect(command).toContain("MENTIKO_CODEX_PROJECT_KEY");
      expect(command).toContain("[projects.\"%s\"]");
      expect(command).toContain("trust_level = \"trusted\"");
      expect(command).toContain("trap 'rm -rf \"$CODEX_HOME\"' EXIT");
      expect(command).not.toContain("--mcp-config");
    }
  });

  it("keeps persisted legacy Codex profiles runnable with the canonical permission flag", () => {
    const root = tempDir();
    const profilePath = join(root, "codex-legacy.json");
    writeJson(profilePath, {
      id: "codex-legacy",
      name: "Codex legacy",
      cli: "codex",
      pipe_flag: "exec",
      permission_flag: "--yolo",
    });

    const command = buildAgentProfileCommand({ profilePath, interactive: false, namespaceId: "default", orgId: "default" });
    expect(command).toContain("'--dangerously-bypass-approvals-and-sandbox'");
    expect(command).not.toContain("'--yolo'");
  });

  it("does not add Codex invocation or isolated-home setup to non-Codex profiles", () => {
    const root = tempDir();
    const profilePath = join(root, "claude.json");
    writeJson(profilePath, { id: "claude", name: "Claude", cli: "claude", pipe_flag: "-p" });
    const command = buildAgentProfileCommand({ profilePath, interactive: false, namespaceId: "default", orgId: "default" });
    expect(command).toContain("'claude' '-p'");
    expect(command).not.toContain("'codex'");
    expect(command).not.toContain("check_for_update_on_startup");
    expect(command).not.toContain("CODEX_HOME");
    expect(command).not.toContain("dangerously-bypass-hook-trust");
  });


  it("rejects malformed profile values before they reach an external CLI", () => {
    const root = tempDir();
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, { id: "profile", name: "Profile", cli: "claude", env: { invalid: "no" } });
    expect(() => buildAgentProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" })).toThrow("Invalid profile env entry");
  });

  it("pre-accepts the Claude workspace-trust dialog for interactive launches so the bypass-permissions prompt never stalls a fresh worktree cwd", () => {
    const root = tempDir();
    const profilePath = join(root, "claude.json");
    writeJson(profilePath, { id: "claude", name: "Claude", cli: "claude", permission_flag: "--dangerously-skip-permissions" });
    const interactive = buildClaudeProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" });
    expect(interactive).toContain("hasTrustDialogAccepted:true");
    expect(interactive).toContain("hasCompletedProjectOnboarding:true");
    expect(interactive).toContain(".claude.json");
    const noninteractive = buildClaudeProfileCommand({ profilePath, interactive: false, namespaceId: "default", orgId: "default" });
    expect(noninteractive).not.toContain("hasTrustDialogAccepted");
  });

  it("does not add the Claude trust pre-write to non-claude profiles", () => {
    const root = tempDir();
    const profilePath = join(root, "codex.json");
    writeJson(profilePath, { id: "codex", name: "Codex", cli: "codex", permission_flag: "--dangerously-bypass-approvals-and-sandbox" });
    const command = buildAgentProfileCommand({ profilePath, interactive: true, namespaceId: "default", orgId: "default" });
    expect(command).not.toContain("hasTrustDialogAccepted");
  });
});

function buildClaudeProfileCommand(input: Parameters<typeof buildAgentProfileCommand>[0]): string {
  const previous = {
    MENTIKO_WEB_URL: process.env.MENTIKO_WEB_URL,
    MENTIKO_SESSION_ID: process.env.MENTIKO_SESSION_ID,
    MENTIKO_SESSION_TOKEN: process.env.MENTIKO_SESSION_TOKEN,
    MENTIKO_CODE_ROOT: process.env.MENTIKO_CODE_ROOT,
  };
  Object.assign(process.env, {
    MENTIKO_WEB_URL: "http://127.0.0.1:3200",
    MENTIKO_SESSION_ID: "test-session",
    MENTIKO_SESSION_TOKEN: "test-token",
    MENTIKO_CODE_ROOT: join(process.cwd(), ".."),
  });
  let command: string | undefined;
  try {
    command = buildAgentProfileCommand(input);
    return command;
  } finally {
    const configPath = command?.match(/--mcp-config' '([^']+)'/)?.[1];
    if (configPath) {
      rmSync(configPath, { force: true });
      rmdirSync(dirname(configPath));
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
