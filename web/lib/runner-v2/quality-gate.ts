export interface AgentDescriptor {
  id: string;
  name?: string;
  role?: string;
}

export interface AgentSummary {
  status?: string;
}

export interface RouteCoverageReport {
  summary?: CoverageValues;
  coverageStats?: CoverageValues;
  coverage?: CoverageValues;
  totalRoutes?: number;
  protectedRoutes?: number;
  unprotectedRoutes?: number;
  protectionRate?: number;
  targetRate?: number;
}

interface CoverageValues {
  totalRoutes?: number;
  protectedRoutes?: number;
  unprotectedRoutes?: number;
  protectionRate?: number;
  targetRate?: number;
}

export interface QualityGateInput {
  agent: AgentDescriptor;
  summary?: AgentSummary;
  routeCoverage?: RouteCoverageReport;
  requiredRouteCoverageRate?: number;
}

export interface QualityGatePass {
  passed: true;
}

export interface QualityGateFail {
  passed: false;
  reason: string;
  details: string;
}

export type QualityGateResult = QualityGatePass | QualityGateFail;

export interface QualityGateFailurePlan {
  artifact: {
    status: "failed";
    agentId: string;
    agentName: string;
    reason: string;
    details: string;
    timestamp: string;
  };
  runStatus: "failed";
  agentStatus: "failed";
  taskStatus: "failed";
  artifactType: "quality-gate";
}

const GATE_AGENT_RE = /(verifier|validator|validation|compliance|tester|reviewer|qa|coverage|quality|gate|auditor)/i;

export function evaluateQualityGate(input: QualityGateInput): QualityGateResult {
  const summaryStatus = input.summary?.status?.trim().toLowerCase();
  if (summaryStatus && ["failed", "failure", "error", "blocked"].includes(summaryStatus)) {
    return {
      passed: false,
      reason: `agent summary status is ${summaryStatus}`,
      details: "summary status is terminal failure",
    };
  }

  if (summaryStatus === "partial" && isQualityGateAgent(input.agent)) {
    return {
      passed: false,
      reason: "quality gate agent summary status is partial",
      details: "summary status partial from gate agent",
    };
  }

  if (routeCoverageGateApplies(input.agent, input.routeCoverage)) {
    const coverage = normalizeCoverage(input.routeCoverage);
    if (coverage) {
      const required = Math.max(input.requiredRouteCoverageRate ?? 100, coverage.targetRate ?? 0);
      if (
        (coverage.totalRoutes ?? 0) > 0 && (coverage.protectedRoutes ?? 0) < (coverage.totalRoutes ?? 0)
        || (coverage.unprotectedRoutes ?? 0) > 0
        || (coverage.totalRoutes ?? 0) > 0 && (coverage.protectionRate ?? 0) < required
      ) {
        return {
          passed: false,
          reason: "route coverage below required gate",
          details: `protected=${coverage.protectedRoutes ?? "unknown"}/${coverage.totalRoutes ?? "unknown"}, unprotected=${coverage.unprotectedRoutes ?? "unknown"}, rate=${coverage.protectionRate ?? "unknown"}%, required=${required}%`,
        };
      }
    }
  }

  return { passed: true };
}

export function isQualityGateAgent(agent: AgentDescriptor): boolean {
  return GATE_AGENT_RE.test([agent.id, agent.name || "", agent.role || ""].join(" "));
}

export function buildQualityGateFailurePlan(
  agent: AgentDescriptor,
  failure: QualityGateFail,
  now = new Date(),
): QualityGateFailurePlan {
  return {
    artifact: {
      status: "failed",
      agentId: agent.id,
      agentName: agent.name || "unknown",
      reason: failure.reason,
      details: failure.details,
      timestamp: now.toISOString(),
    },
    runStatus: "failed",
    agentStatus: "failed",
    taskStatus: "failed",
    artifactType: "quality-gate",
  };
}

function routeCoverageGateApplies(agent: AgentDescriptor, report?: RouteCoverageReport): boolean {
  return Boolean(report) || /route.*coverage|coverage.*route/i.test(agent.id);
}

function normalizeCoverage(report?: RouteCoverageReport): CoverageValues | null {
  if (!report) return null;
  return report.summary || report.coverageStats || report.coverage || report;
}
