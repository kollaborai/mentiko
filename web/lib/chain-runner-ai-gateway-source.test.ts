/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

describe("chain-runner AI gateway source contract", () => {
  const chainRunner = readFileSync(new URL("../../lib/chain-runner.sh", import.meta.url), "utf8");
  const ptyManager = readFileSync(new URL("../../lib/pty-manager.mjs", import.meta.url), "utf8");
  const agentFunctions = readFileSync(new URL("../../lib/agent-functions.sh", import.meta.url), "utf8");
  const sessionLogResolverPath = fileURLToPath(new URL("../../lib/session-log-resolver.sh", import.meta.url));
  const sessionLogResolver = readFileSync(new URL("../../lib/session-log-resolver.sh", import.meta.url), "utf8");
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
    expect(agentFunctions).toContain("runner-v2-completion-launch.js");
    expect(agentFunctions).toContain('node "$completion_launcher" "$session_name" "$chain_file"');
    expect(agentFunctions).not.toContain("MENTIKO_AI_GATEWAY_LOCAL_TOKEN=");
    expect(agentFunctions).not.toContain("complete-gw-env-XXXXXX");
    expect(agentFunctions).not.toContain("bash -lc");
  });

  it("resolves better-sqlite3 via the web node_modules from pty-manager", () => {
    expect(ptyManager).toContain('createRequire(join(__dirname, "..", "web", "package.json"))');
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
    expect(chainRunner).toContain("MENTIKO_SESSION_ID=%q");
    expect(chainRunner).toContain("MENTIKO_SESSION_TOKEN=%q");
    expect(chainRunner).toContain("MENTIKO_WEB_URL=%q");
    expect(chainRunner).toContain("KOLLABOR_ENGINE_URL=%q");
    // hub-disable env removed: mentiko no longer forces kollab into single-process
    // mode, so the koordinator can use its hub. Guard the removal so it doesn't
    // creep back in (was KOLLAB_NO_HUB=1 / KOLLAB_HUB_DISABLED=1).
    expect(chainRunner).not.toContain("KOLLAB_NO_HUB");
    expect(chainRunner).not.toContain("KOLLAB_HUB_DISABLED");
  });

  it("sets the visible local pty shell cwd to the workspace before launching agents", () => {
    expect(chainRunner).toContain('send-message "$session_name" "cd $(printf \'%q\' "$REMOTE_PROJECT_ROOT") && bash $(printf \'%q\' "$start_script")"');
  });

  it("checks profile-driven readiness before sending instructions to a launched CLI", () => {
    const guard = "wait_for_profile_readiness";
    const sendInstructions = 'send-message "$session_name" "$instruction_pointer"';
    const readinessStart = chainRunner.indexOf("wait_for_profile_readiness()" );
    const readinessEnd = chainRunner.indexOf("instruction_submission_marker()", readinessStart);
    const readinessBody = chainRunner.slice(readinessStart, readinessEnd);

    expect(chainRunner).toContain('source "$SCRIPT_DIR/cli-readiness.sh"');
    expect(chainRunner).toContain(guard);
    expect(chainRunner).toContain("startup_recovery");
    expect(readinessBody).toContain("_cli_readiness_cli wait");
    expect(readinessBody).toContain("--recovery-enabled");
    expect(readinessBody).toContain("--artifact-dir");
    expect(readinessBody).not.toContain("write_startup_recovery_artifacts");
    expect(readinessBody).not.toContain("transport_capture");
    expect(readinessBody).not.toContain("jq");
    expect(readinessBody).not.toMatch(/\bwhile\b|\bsleep\b|\bdate\b/);
    expect(chainRunner).not.toContain("cli-startup-prompts.sh");
    expect(chainRunner).not.toContain("seed-agent-cli-config.sh");
    expect(chainRunner.indexOf(guard)).toBeGreaterThan(-1);
    expect(chainRunner.indexOf(sendInstructions)).toBeGreaterThan(-1);
    expect(chainRunner.indexOf(guard)).toBeLessThan(chainRunner.indexOf(sendInstructions));
  });

  it("resubmits instructions when a TUI keeps the pasted prompt in the input box", () => {
    expect(chainRunner).toContain("instruction_submission_marker()");
    expect(chainRunner).toContain("ensure-instructions-submitted()");
    expect(chainRunner).toContain('marker="$(instruction_submission_marker "$instructions")"');
    expect(chainRunner).toContain('instructions still visible after send; pressing enter again');
    expect(chainRunner).toContain('transport_send_raw "$session_name" $\'\\r\'');
    expect(chainRunner).toContain('ensure-instructions-submitted "$session_name" "$instruction_pointer" "$instruction_send_capture"');
  });

  it("keeps conversation birth-time lookup numeric on GNU stat", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-stat-"));
    try {
      const fakeStat = join(root, "stat");
      writeFileSync(
        fakeStat,
        [
          "#!/usr/bin/env bash",
          "if [[ \"$1\" == \"-f\" ]]; then",
          "  echo '  File: \"fake.jsonl\"'",
          "  echo 'Blocks: Total: 1'",
          "  exit 0",
          "fi",
          "if [[ \"$1\" == \"-c\" && \"$2\" == \"%W\" ]]; then",
          "  echo 1779903268",
          "  exit 0",
          "fi",
          "if [[ \"$1\" == \"-c\" && \"$2\" == \"%Y\" ]]; then",
          "  echo 1779903269",
          "  exit 0",
          "fi",
          "exit 1",
          "",
        ].join("\n")
      );
      chmodSync(fakeStat, 0o755);

      const script = [
        "set -euo pipefail",
        `source ${shellQuote(sessionLogResolverPath)}`,
        `value=$(_file_birth_epoch ${shellQuote(join(root, "fake.jsonl"))})`,
        '[[ "$value" == "1779903268" ]]',
      ].join("\n");

      execFileSync("bash", ["-c", script], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH || ""}` },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it("uses org-scoped profile paths in the remaining shell bootstrap", () => {
    expect(chainRunner).toContain("AGENT_PROFILES_DIR");
    expect(chainRunner).not.toContain("NAMESPACE_ROOT/agent-profiles");
    expect(sessionLogResolver).toContain('[[ "$value" =~ ^[0-9]+$');
  });

  it("binds shell monitor completion to runner-v2 without a shell fallback", () => {
    expect(agentFunctions).toContain("runner-v2-completion-launch.js");
    expect(agentFunctions).not.toContain("runner-v2-completion-launch.cjs");
    expect(agentFunctions).not.toContain("chain-runner-complete.sh");
    expect(agentFunctions).not.toContain("complete-agent.sh");
    expect(agentFunctions).toContain("no shell completion fallback exists");
  });
});

describe("chain launch surfaces pass local proxy env to runners", () => {
  const files = [
    "./runs/chain-run-service.ts",
    "../../web/app/api/runs/[id]/resume/route.ts",
    "../../web/app/api/schedules/route.ts",
    "../../web/app/api/chains/run-batch/route.ts",
    "./schedules/scheduler-service.ts",
  ];

  for (const file of files) {
    it(`${file} passes local proxy env`, () => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("buildLocalAiGatewayProxyEnv");
    });
  }

  it("passes request origins when route handlers have them", () => {
    const routeFiles = [
      "./runs/chain-run-service.ts",
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

describe("chain runner next launch flag contract", () => {
  const source = readFileSync(new URL("./runs/chain-run-service.ts", import.meta.url), "utf8");
  const childEnvSource = readFileSync(new URL("./runs/child-env.ts", import.meta.url), "utf8");

  it("keeps MENTIKO_RUNNER_V2 reachable after child env filtering", () => {
    expect(childEnvSource).toContain('"MENTIKO_RUNNER_V2"');
    expect(childEnvSource).toContain('"MENTIKO_RUNNER_V2_COMPLETION"');
    expect(source.indexOf("const childEnv = buildChildEnv")).toBeGreaterThan(-1);
    expect(source.indexOf("isRunnerV2Enabled(childEnv)")).toBeGreaterThan(source.indexOf("const childEnv = buildChildEnv"));
  });

  it("falls back to the shell runner when runner-next is disabled or unsupported", () => {
    expect(source).toContain('runnerV2Launch?.support === "supported"');
    expect(source).toMatch(/spawn\(\s*"\/bin\/zsh"/);
    expect(source).toContain('["-lc", `${shellEscape(binPath)} run ${shellEscape(validatedChainPath)}');
  });
});

describe("chain run profile override contract", () => {
  const source = readFileSync(new URL("./runs/chain-run-service.ts", import.meta.url), "utf8");

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
    expect(source).toContain('import { resolveRunAgentProfileId } from "@/lib/agents/run-agent-profile"');
    expect(source).toContain("const effectiveAgentProfileId = resolveRunAgentProfileId");
    expect(source).toContain("chainDefaultProfileId: runChain.default_agent_profile");
    expect(source).toContain("workspaceDefaultProfileId: resolvedWorkspaceRecord?.default_agent_profile");
    expect(source).toContain("runChain = applyRuntimeAgentProfileOverride(runChain, runtimeProfile?.id)");
  });

  it("resume reads the stamped run-local chain profile from the top-level field", () => {
    const resumeSource = readFileSync(new URL("../../web/app/api/runs/[id]/resume/route.ts", import.meta.url), "utf8");
    expect(resumeSource).toContain("chainJson.default_agent_profile || chainJson.config?.default_agent_profile");
  });
});

describe("chain run decision metadata contract", () => {
  const source = readFileSync(new URL("./runs/chain-run-service.ts", import.meta.url), "utf8");

  it("persists decision metadata and exports it to chain agents", () => {
    expect(source).toContain("metadata: runMetadata");
    expect(source).toContain("MENTIKO_DECISION_IMPORT_TOKEN");
    expect(source).toContain("MENTIKO_DECISION_ID");
    expect(source).toContain("MENTIKO_DECISION_PHASE");
    expect(source).toContain("MENTIKO_DECISION_SELECTED_OPTION_ID");
    expect(source).toContain("MENTIKO_DECISION_WORKSPACE_PATH");
  });
});

describe("chain run session actor contract", () => {
  const source = readFileSync(new URL("./runs/chain-run-service.ts", import.meta.url), "utf8");

  it("accepts verified MCP ops session-token bearer claims, not only browser cookies", () => {
    expect(source).toContain('import { mintSessionToken, verifySessionToken } from "@/lib/auth/session-token"');
    expect(source).toContain("async function resolveChainSessionActor");
    expect(source).toContain("const claims = await verifySessionToken");
    expect(source).toContain("claims.ns !== namespaceId || claims.org !== orgId");
    expect(source).toContain("resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspace, actor?.id)");
    expect(source).toContain("buildChainSessionEnv(request, namespaceId, orgId, runId, actor)");
  });
});
