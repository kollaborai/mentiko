/** @jest-environment node */

import { readFileSync } from "node:fs";

describe("typed direct-run gateway, context, and readiness ownership", () => {
  const chainRunner = readFileSync(new URL("../../lib/chain-runner.sh", import.meta.url), "utf8");
  const directRun = readFileSync(new URL("runner-v2/direct-run.ts", import.meta.url), "utf8");
  const bootstrapPlan = readFileSync(new URL("runner-v2/agent-bootstrap-plan.ts", import.meta.url), "utf8");
  const readinessPolicy = readFileSync(new URL("runner-v2/readiness-policy.ts", import.meta.url), "utf8");
  const chainService = readFileSync(new URL("runs/chain-run-service.ts", import.meta.url), "utf8");
  const typedGatewayEnv = readFileSync(new URL("../../lib/ai-gateway-agent-env.mjs", import.meta.url), "utf8");
  const seedScript = readFileSync(new URL("../scripts/seed.ts", import.meta.url), "utf8");
  const smokeAgent = readFileSync(new URL("../../bin/ai-gateway-smoke-agent.mjs", import.meta.url), "utf8");

  it("keeps the legacy filename as an argument-only typed entrypoint", () => {
    expect(chainRunner).toContain('exec node "$SCRIPT_DIR/runner-v2-direct-run.js" "$@"');
    expect(chainRunner).not.toContain("ai-gateway-agent-env.sh");
    expect(chainRunner).not.toContain("jq");
  });

  it("keeps gateway injection, run context, and readiness in typed owners", () => {
    expect(typedGatewayEnv).toContain("OPENAI_BASE_URL=${baseUrl}");
    expect(typedGatewayEnv).toContain("MENTIKO_AI_GATEWAY_PROXY=local");
    expect(chainService).toContain("buildLocalAiGatewayProxyEnv");
    expect(directRun).toContain("runId: options.runId");
    expect(bootstrapPlan).toContain("profileReadiness");
    expect(readinessPolicy).toContain("Classify a PTY capture");
  });

  it("ships the tenant gateway smoke profile through typed runtime inputs", () => {
    expect(seedScript).toContain('id: "mentiko-ai-gateway-smoke"');
    expect(seedScript).toContain('node "$MENTIKO_CODE_ROOT/bin/ai-gateway-smoke-agent.mjs"');
    expect(smokeAgent).toContain("OPENAI_BASE_URL");
    expect(smokeAgent).toContain("OPENAI_API_KEY");
    expect(smokeAgent).toContain("AGENT_COMPLETE");
  });

  it("does not relaunch a shell runner when the old feature flag is on or off", () => {
    // Both the synchronous (default) and deferred (decision-phase, FIX 6)
    // launch paths call the SAME typed launcher through the SAME shared
    // context object -- proving neither branch drifted onto a shell runner.
    expect(chainService.match(/startRunnerV2Launch\(runnerV2LaunchContext\)/g)).toHaveLength(2);
    expect(chainService).not.toContain("isRunnerV2Enabled");
    expect(chainService).not.toMatch(/spawn\(\s*[\"']\/bin\/zsh/);
    expect(chainService).not.toContain("bin/mentiko");
    expect(chainService).not.toContain("chain-runner.sh");
  });
});
