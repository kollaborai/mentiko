import { buildQualityGateFailurePlan, evaluateQualityGate, isQualityGateAgent } from "@/lib/runner-v2/quality-gate";

describe("runner-v2 quality gate", () => {
  it("fails terminal summary statuses", () => {
    expect(evaluateQualityGate({
      agent: { id: "writer" },
      summary: { status: "FAILED" },
    })).toEqual({
      passed: false,
      reason: "agent summary status is failed",
      details: "summary status is terminal failure",
    });
  });

  it("fails partial summaries only for gate-like agents", () => {
    expect(isQualityGateAgent({ id: "coverage-reviewer", role: "qa" })).toBe(true);
    expect(evaluateQualityGate({
      agent: { id: "coverage-reviewer", role: "qa" },
      summary: { status: "partial" },
    })).toEqual({
      passed: false,
      reason: "quality gate agent summary status is partial",
      details: "summary status partial from gate agent",
    });

    expect(evaluateQualityGate({
      agent: { id: "writer" },
      summary: { status: "partial" },
    })).toEqual({ passed: true });
  });

  it("fails route coverage below required gate", () => {
    expect(evaluateQualityGate({
      agent: { id: "route-coverage" },
      routeCoverage: {
        summary: {
          totalRoutes: 10,
          protectedRoutes: 9,
          unprotectedRoutes: 1,
          protectionRate: 90,
          targetRate: 95,
        },
      },
      requiredRouteCoverageRate: 80,
    })).toEqual({
      passed: false,
      reason: "route coverage below required gate",
      details: "protected=9/10, unprotected=1, rate=90%, required=95%",
    });
  });

  it("passes route coverage that meets required and reported target rates", () => {
    expect(evaluateQualityGate({
      agent: { id: "route-coverage" },
      routeCoverage: {
        totalRoutes: 10,
        protectedRoutes: 10,
        unprotectedRoutes: 0,
        protectionRate: 100,
        targetRate: 100,
      },
      requiredRouteCoverageRate: 90,
    })).toEqual({ passed: true });
  });

  it("passes a zero-route coverage report instead of treating a missing protectionRate as 0%", () => {
    expect(evaluateQualityGate({
      agent: { id: "route-coverage" },
      routeCoverage: {
        totalRoutes: 0,
      },
    })).toEqual({ passed: true });
  });

  it("builds the shell-compatible quality gate failure side-effect plan", () => {
    expect(buildQualityGateFailurePlan(
      { id: "qa", name: "QA" },
      { passed: false, reason: "agent summary status is failed", details: "summary=qa-summary.json" },
      new Date("2026-06-25T12:00:00.000Z"),
    )).toEqual({
      artifact: {
        status: "failed",
        agentId: "qa",
        agentName: "QA",
        reason: "agent summary status is failed",
        details: "summary=qa-summary.json",
        timestamp: "2026-06-25T12:00:00.000Z",
      },
      runStatus: "failed",
      agentStatus: "failed",
      taskStatus: "failed",
      artifactType: "quality-gate",
    });
  });
});
