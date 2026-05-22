/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";

describe("job-runner AI gateway source contract", () => {
  const source = readFileSync(new URL("../../lib/job-runner.mjs", import.meta.url), "utf8");

  it("routes providerless child AI calls through the local gateway proxy", () => {
    expect(source).toContain('import { buildAiGatewayAgentEnv } from "./ai-gateway-agent-env.mjs";');
    expect(source).toContain("const childEnv = buildAiGatewayAgentEnv(process.env, profileEnv);");
  });

  it("applies the local proxy after inherited provider keys are stripped and before spawn", () => {
    const envCall = source.indexOf("buildAiGatewayAgentEnv(process.env, profileEnv);");
    const spawnCall = source.indexOf("spawnProcess(resolvedCli, resolvedArgs", envCall);

    expect(envCall).toBeGreaterThan(-1);
    expect(envCall).toBeLessThan(spawnCall);
  });
});
