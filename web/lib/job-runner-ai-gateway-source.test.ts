/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";
import { parseAiJsonOutput } from "../../lib/job-runner-output-parser.mjs";

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

  it("keeps kollab pipe jobs aligned with the detached runner timeout", () => {
    expect(source).toContain('const RUNNER_CHILD_TIMEOUT_MS = 480000;');
    expect(source).toContain('const KOLLAB_PIPE_TIMEOUT = "8min";');
    expect(source).toContain("ensureKollabPipeTimeout(resolvedCli, resolvedProfile.cliArgs)");
    expect(source).toContain("timeout: RUNNER_CHILD_TIMEOUT_MS");
  });

  it("parses the final JSON object from kollab tool transcripts", () => {
    const transcript = [
      "I need to inspect this first.",
      "Executed terminal: function runtimeRoots() { return null; }",
      "```json",
      JSON.stringify({
        title: "Floating code editor directory scope",
        brief: { headline: "Use the editor against allowed data directories." },
      }),
      "```",
    ].join("\n");

    expect(parseAiJsonOutput(transcript)).toMatchObject({
      title: "Floating code editor directory scope",
      brief: { headline: "Use the editor against allowed data directories." },
    });
  });
});
