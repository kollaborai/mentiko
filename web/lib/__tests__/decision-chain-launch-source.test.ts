import { readFileSync } from "node:fs";

const decisionRoutes = [
  "../../app/api/decisions/[id]/research/route.ts",
  "../../app/api/decisions/[id]/guided/questions/route.ts",
  "../../app/api/decisions/[id]/guided/options/route.ts",
  "../../app/api/decisions/[id]/guided/plan/route.ts",
  "../../app/api/decisions/[id]/guided/synthesize/route.ts",
  "../../app/api/decisions/[id]/retrospective/route.ts",
];

describe("decision chain launch source contract", () => {
  test("decision generation routes launch visible chain runs", () => {
    for (const route of decisionRoutes) {
      const source = readFileSync(new URL(route, import.meta.url), "utf8");
      expect(source).toContain("startDecisionChainRun");
      expect(source).not.toContain("launchJobRunner");
    }
  });

  test("shared chain run service preserves the route response shape", () => {
    const source = readFileSync(new URL("../runs/chain-run-service.ts", import.meta.url), "utf8");
    expect(source).toContain("export interface StartChainRunResult");
    expect(source).toContain("runId: string");
    expect(source).toContain("chainId: string");
    expect(source).toContain('status: "started"');
  });

  test("guided flow guards round 2 against duplicate run launches", () => {
    const source = readFileSync(new URL("../../components/guided-flow/guided-flow-shell.tsx", import.meta.url), "utf8");
    expect(source).toContain("if (autoRound2Ref.current) return;");
    expect(source).toContain("autoRound2Ref.current = true;");
    expect(source).not.toContain("autoRound2Ref.current = true;\n      startRound2();");
  });
});
