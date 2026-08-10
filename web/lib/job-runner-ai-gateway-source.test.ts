/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";
import { parseAiJsonOutput } from "../../lib/job-runner-output-parser.mjs";

describe("typed job worker AI gateway source contract", () => {
  const source = readFileSync(new URL("runner-v2/job-worker.ts", import.meta.url), "utf8");

  it("routes providerless child AI calls through the local gateway proxy", () => {
    expect(source).toContain('import { buildAiGatewayAgentEnv } from "../../../lib/ai-gateway-agent-env.mjs";');
    expect(source).toContain("const childEnv = buildAiGatewayAgentEnv(process.env, profileEnv);");
  });

  it("applies the local proxy after inherited provider keys are stripped and before spawn", () => {
    const envCall = source.indexOf("buildAiGatewayAgentEnv(process.env, profileEnv);");
    const spawnCall = source.indexOf("spawnProcess(resolvedCli, resolvedArgs", envCall);

    expect(envCall).toBeGreaterThan(-1);
    expect(envCall).toBeLessThan(spawnCall);
  });

  it("does not inject kollab-specific runtime args outside the configured profile", () => {
    expect(source).toContain('const RUNNER_CHILD_TIMEOUT_MS = 480000;');
    expect(source).not.toContain(["KOLLAB", "PIPE", "TIMEOUT"].join("_"));
    expect(source).not.toContain(["ensure", "Kollab", "Pipe", "Timeout"].join(""));
    expect(source).toContain("const resolvedArgs = resolvedProfile.cliArgs;");
    expect(source).toContain("timeout: RUNNER_CHILD_TIMEOUT_MS");
  });

  it("keeps task-generation jobs non-terminal until the import callback finishes", () => {
    const successBoundary = source.indexOf("// Task-generation completion has a server-side import step.");
    const completionSource = source.slice(successBoundary);

    expect(completionSource).toContain('const callbackStatus = job.type === "task" ? "complete" : job.status;');
    expect(completionSource).toContain('job.status = job.type === "task" ? "running" : "complete";');
    expect(completionSource).toContain("await notifyCompletion(callbackStatus);");
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
