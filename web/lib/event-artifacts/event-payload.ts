export interface QualityGateFailedPayload {
  event: {
    name: "quality_gate.failed";
    source: "runner-v2";
    timestamp: string;
  };
  namespace: {
    id: string;
  };
  org: {
    id: string;
  };
  run: {
    id: string;
    chainId?: string;
    chainName?: string;
    status: string;
    artifactsDir: string;
  };
  task?: {
    id: string;
    title: string;
    status: string;
    type?: string;
    priority?: number;
    parentTaskId?: string;
    acceptanceCriteria?: string;
  };
  qualityGate: {
    status: "partial" | "failed";
    agentId?: string;
    reason: string;
    summaryPath?: string;
    findings: string[];
    risks: string[];
    nextActions: string[];
  };
  evidence: {
    changedFiles: string[];
    liveSessions: string[];
    artifacts: string[];
  };
}

export function boundedStrings(values: unknown, limit = 10): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim())
    .slice(0, limit);
}
