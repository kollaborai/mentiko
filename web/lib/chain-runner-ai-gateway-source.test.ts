/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";

describe("chain-runner AI gateway source contract", () => {
  const chainRunner = readFileSync(new URL("../../lib/chain-runner.sh", import.meta.url), "utf8");
  const jsChainRunner = readFileSync(new URL("../../lib/chain-runner.mjs", import.meta.url), "utf8");
  const ptyManager = readFileSync(new URL("../../lib/pty-manager.mjs", import.meta.url), "utf8");
  const agentFunctions = readFileSync(new URL("../../lib/agent-functions.sh", import.meta.url), "utf8");
  const chainRunnerComplete = readFileSync(new URL("../../lib/chain-runner-complete.sh", import.meta.url), "utf8");
  const shellHelper = readFileSync(new URL("../../lib/ai-gateway-agent-env.sh", import.meta.url), "utf8");
  const seedScript = readFileSync(new URL("../../web/scripts/seed.ts", import.meta.url), "utf8");
  const smokeAgent = readFileSync(new URL("../../bin/ai-gateway-smoke-agent.mjs", import.meta.url), "utf8");

  it("adds the tenant local proxy to shell agent env without exposing control vars", () => {
    expect(chainRunner).toContain('source "$SCRIPT_DIR/ai-gateway-agent-env.sh"');
    expect(chainRunner).toContain("ai_gateway_local_proxy_env_lines");
    expect(chainRunner).toContain("gateway_env_vars=");
    expect(shellHelper).toContain("OPENAI_BASE_URL=%s");
    expect(shellHelper).toContain("OPENAI_API_BASE=%s");
    expect(shellHelper).toContain("OPENAI_API_KEY=%s");
    expect(shellHelper).toContain("MENTIKO_AI_GATEWAY_PROXY=local");
    expect(shellHelper).toContain("MENTIKO_AI_GATEWAY_LOCAL_TOKEN");
  });

  it("strips inherited provider credentials before starting local, ssh, and docker agents", () => {
    expect(shellHelper).toContain("ai_gateway_agent_unset_command()");
    expect(shellHelper).toContain("ANTHROPIC_API_KEY");
    expect(shellHelper).toContain("OPENAI_API_KEY");
    expect(shellHelper).toContain("GLM_TOKEN");
    expect(shellHelper).toContain("MENTIKO_AI_GATEWAY_LOCAL_TOKEN");

    const unsetCallCount = (chainRunner.match(/ai_gateway_agent_unset_command/g) || []).length;
    expect(unsetCallCount).toBeGreaterThanOrEqual(3);
  });

  it("preserves local proxy config for monitor-triggered downstream agents", () => {
    expect(chainRunner).toContain('mon_script=$(mktemp "/tmp/monitor-${session_name}.XXXXXX")');
    expect(chainRunner).toContain('chmod 600 "$mon_script"');
    expect(chainRunner).toContain('trap \'rm -f "\\$0"\' EXIT');
    expect(chainRunner).toContain('rm -f "\\$0"');
    expect(chainRunner).toContain("ai_gateway_append_local_proxy_control_exports");
    expect(chainRunner).toContain('if [[ "$WORKSPACE_TYPE" == "local" ]]; then');
    expect(agentFunctions).toContain("MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED");
    expect(agentFunctions).toContain("MENTIKO_AI_GATEWAY_LOCAL_BASE_URL");
    expect(agentFunctions).toContain("MENTIKO_AI_GATEWAY_LOCAL_TOKEN");
    expect(agentFunctions).toContain("complete-gw-env-XXXXXX");
    expect(agentFunctions).toContain('chmod 600 "$completion_env_file"');
    expect(agentFunctions).toContain('bash -lc "$completion_cmd"');
    expect(agentFunctions).not.toContain('MENTIKO_AI_GATEWAY_LOCAL_TOKEN="${MENTIKO_AI_GATEWAY_LOCAL_TOKEN:-}"');
  });

  it("keeps the JavaScript chain-runner on the same env helper", () => {
    expect(jsChainRunner).toContain('import { buildPtyAiGatewayAgentEnv } from "./ai-gateway-agent-env.mjs";');
    expect(jsChainRunner).toContain("const agentEnv = buildPtyAiGatewayAgentEnv(tierEnv, env);");
    expect(jsChainRunner).toContain("env: agentEnv");
    expect(jsChainRunner).toContain("MENTIKO_RUN_ID: this.runId ||");
    expect(jsChainRunner).toContain("RUN_ID: this.runId ||");
    expect(jsChainRunner).toContain("MENTIKO_AGENT_ID: agentId");
    expect(jsChainRunner).toContain("MENTIKO_AGENT_EMITS: agent.emits ||");
    expect(jsChainRunner).toContain("EVENTS_DIR: p.eventsDir");
    expect(jsChainRunner).toContain("ARTIFACTS_DIR: this.runId ?");
    expect(jsChainRunner).toContain("setTimeout(r, 100)");
    expect(ptyManager).toContain('createRequire(join(__dirname, "..", "web", "package.json"))');
  });

  it("keeps the JavaScript chain-runner from using stale profiles as bare Claude", () => {
    expect(jsChainRunner).toContain("function resolveAgentProfile(agent, chain, workspacePath = null)");
    expect(jsChainRunner).toContain("findWorkspaceProfile(workspacePath)");
    expect(jsChainRunner).toContain("findDefaultProfile()");
    expect(jsChainRunner).toContain("requested agent profile");
    expect(jsChainRunner).toContain("no agent profile resolved for agent");
    expect(jsChainRunner).not.toContain('let cmd = "claude";');
  });

  it("passes run context into shell pty agent commands", () => {
    expect(chainRunner).toContain("agent_run_context_export_command()");
    expect(chainRunner).toContain('run_context_exports=$(agent_run_context_export_command "$agent_id" "$agent_emits")');
    expect(chainRunner).toContain('start_script=$(mktemp "/tmp/agent-start-${session_name}.XXXXXX")');
    expect(chainRunner).toContain('printf \'%s\\n\' "$run_context_exports"');
    expect(chainRunner).toContain('remote_start="$remote_start && $run_context_exports');
    expect(chainRunner).toContain("MENTIKO_RUN_ID=%q");
    expect(chainRunner).toContain("RUN_ID=%q");
    expect(chainRunner).toContain("MENTIKO_AGENT_ID=%q");
    expect(chainRunner).toContain("MENTIKO_AGENT_EMITS=%q");
    expect(chainRunner).toContain("ARTIFACTS_DIR=%q");
  });

  it("ships a first-class tenant AI gateway smoke profile and chain", () => {
    expect(seedScript).toContain('id: "mentiko-ai-gateway-smoke"');
    expect(seedScript).toContain('name: "AI Gateway Smoke"');
    expect(seedScript).toContain('default_agent_profile: "mentiko-ai-gateway-smoke"');
    expect(seedScript).toContain('node "$MENTIKO_CODE_ROOT/bin/ai-gateway-smoke-agent.mjs"');
    expect(smokeAgent).toContain("OPENAI_BASE_URL");
    expect(smokeAgent).toContain("OPENAI_API_KEY");
    expect(smokeAgent).toContain("gateway smoke ok");
    expect(smokeAgent).toContain("gateway returned unexpected content");
    expect(smokeAgent).toContain("AGENT_COMPLETE");
  });

  it("checks gateway smoke content via the strict match helper, not raw substring", () => {
    expect(smokeAgent).toContain('from "./ai-gateway-smoke-match.mjs"');
    expect(smokeAgent).toContain("isExpectedSmokeContent(content, expectedContent)");
    expect(smokeAgent).not.toContain("normalizedContent.includes(expectedContent)");
  });

  it("uses org-scoped profile paths in bash run and completion flows", () => {
    expect(chainRunner).toContain("AGENT_PROFILES_DIR");
    expect(chainRunner).not.toContain("NAMESPACE_ROOT/agent-profiles");
    expect(chainRunnerComplete).toContain("AGENT_PROFILES_DIR");
    expect(chainRunnerComplete).not.toContain("NAMESPACE_ROOT/agent-profiles");
  });
});

describe("chain launch surfaces pass local proxy env to runners", () => {
  const files = [
    "../../web/lib/chain-run-service.ts",
    "../../web/app/api/runs/[id]/resume/route.ts",
    "../../web/app/api/schedules/route.ts",
    "../../web/app/api/chains/run-batch/route.ts",
    "./scheduler-service.ts",
  ];

  for (const file of files) {
    it(`${file} passes local proxy env`, () => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("buildLocalAiGatewayProxyEnv");
    });
  }

  it("passes request origins when route handlers have them", () => {
    const routeFiles = [
      "../../web/lib/chain-run-service.ts",
      "../../web/app/api/runs/[id]/resume/route.ts",
      "../../web/app/api/schedules/route.ts",
      "../../web/app/api/chains/run-batch/route.ts",
    ];

    for (const file of routeFiles) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toContain("buildLocalAiGatewayProxyEnv()");
      expect(source).toContain("buildLocalAiGatewayProxyEnv(new URL(");
    }
  });
});

describe("chain run profile override contract", () => {
  const source = readFileSync(new URL("../../web/lib/chain-run-service.ts", import.meta.url), "utf8");

  it("stamps request-selected agent profile onto the run-local chain", () => {
    expect(source).toContain("applyRuntimeAgentProfileOverride");
    expect(source).toContain("default_agent_profile: agentProfileId");
    expect(source).toContain("runChain = applyRuntimeAgentProfileOverride(runChain, runtimeProfile?.id)");
  });

  it("rejects missing request-selected agent profiles instead of falling back silently", () => {
    expect(source).toContain('throw new BadRequest("Agent profile not found"');
    expect(source).toContain("const requestedAgentProfileId =");
    expect(source).toContain("profiles.find((profile) => profile.id === requestedAgentProfileId)");
    expect(source).toContain("value: requestedAgentProfileId");
  });

  it("resolves stale chain defaults before stamping the run-local chain", () => {
    expect(source).toContain('import { resolveRunAgentProfileId } from "@/lib/run-agent-profile"');
    expect(source).toContain("const effectiveAgentProfileId = resolveRunAgentProfileId");
    expect(source).toContain("chainDefaultProfileId: runChain.default_agent_profile");
    expect(source).toContain("workspaceDefaultProfileId: resolvedWorkspaceRecord?.default_agent_profile");
    expect(source).toContain("runChain = applyRuntimeAgentProfileOverride(runChain, runtimeProfile?.id)");
  });
});

describe("chain run decision metadata contract", () => {
  const source = readFileSync(new URL("../../web/lib/chain-run-service.ts", import.meta.url), "utf8");

  it("persists decision metadata and exports it to chain agents", () => {
    expect(source).toContain("metadata: runMetadata");
    expect(source).toContain("MENTIKO_DECISION_IMPORT_TOKEN");
    expect(source).toContain("MENTIKO_DECISION_ID");
    expect(source).toContain("MENTIKO_DECISION_PHASE");
    expect(source).toContain("MENTIKO_DECISION_SELECTED_OPTION_ID");
    expect(source).toContain("MENTIKO_DECISION_WORKSPACE_PATH");
  });
});
