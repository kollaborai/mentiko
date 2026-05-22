/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

describe("ai-gateway-agent-env.sh", () => {
  const helperPath = fileURLToPath(new URL("../../lib/ai-gateway-agent-env.sh", import.meta.url));

  function run(script: string): string {
    return execFileSync("bash", ["-lc", `source ${shellQuote(helperPath)}; ${script}`], {
      encoding: "utf8",
    });
  }

  it("emits local OpenAI-compatible proxy env only for local workspaces", () => {
    const base =
      "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED=true " +
      "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL=http://127.0.0.1:3000/api/ai-gateway/local/v1 " +
      "MENTIKO_AI_GATEWAY_LOCAL_TOKEN=local-token";

    const localOutput = run(`${base} ai_gateway_local_proxy_env_lines "" "" local`);
    expect(localOutput).toContain("OPENAI_BASE_URL=http://127.0.0.1:3000/api/ai-gateway/local/v1");
    expect(localOutput).toContain("OPENAI_API_KEY=local-token");

    expect(run(`${base} ai_gateway_local_proxy_env_lines "" "" ssh`)).toBe("");
    expect(run(`${base} ai_gateway_local_proxy_env_lines "" "" docker`)).toBe("");
  });

  it("does not override an explicit provider credential", () => {
    const output = run(
      "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED=true " +
        "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL=http://127.0.0.1:3000/api/ai-gateway/local/v1 " +
        "MENTIKO_AI_GATEWAY_LOCAL_TOKEN=local-token " +
        'ai_gateway_local_proxy_env_lines "" "OPENAI_API_KEY=explicit" local',
    );

    expect(output).toBe("");
  });

  it("quotes exported gateway env values before sourcing", () => {
    const output = run(
      "tmp=$(mktemp /tmp/ai-gateway-env-test-XXXXXX); " +
        "ai_gateway_append_export_lines \"$tmp\" $'OPENAI_API_KEY=tok with spaces $(echo bad)\\nOPENAI_BASE_URL=http://127.0.0.1:3000/api/ai-gateway/local/v1'; " +
        "cat \"$tmp\"; rm -f \"$tmp\"",
    );

    expect(output).toContain("export OPENAI_API_KEY=tok\\ with\\ spaces\\ \\$\\(echo\\ bad\\)");
    expect(output).toContain("export OPENAI_BASE_URL=http://127.0.0.1:3000/api/ai-gateway/local/v1");
  });
});
