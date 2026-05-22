/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";

describe("chain-runner AI gateway source contract", () => {
  const chainRunner = readFileSync(new URL("../../lib/chain-runner.sh", import.meta.url), "utf8");
  const jsChainRunner = readFileSync(new URL("../../lib/chain-runner.mjs", import.meta.url), "utf8");
  const ptyManager = readFileSync(new URL("../../lib/pty-manager.mjs", import.meta.url), "utf8");
  const agentFunctions = readFileSync(new URL("../../lib/agent-functions.sh", import.meta.url), "utf8");
  const shellHelper = readFileSync(new URL("../../lib/ai-gateway-agent-env.sh", import.meta.url), "utf8");

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
    expect(jsChainRunner).toContain("setTimeout(r, 100)");
    expect(ptyManager).toContain('createRequire(join(__dirname, "..", "web", "package.json"))');
  });
});

describe("chain launch surfaces pass local proxy env to runners", () => {
  const files = [
    "../../web/app/api/chains/run/route.ts",
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
      "../../web/app/api/chains/run/route.ts",
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
