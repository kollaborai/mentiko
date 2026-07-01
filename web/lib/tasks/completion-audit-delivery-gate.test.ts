/**
 * @jest-environment node
 *
 * Regression coverage for the FEAT-014 failure: a 4-agent chain
 * (api-pattern-analyzer, change-categorization-designer,
 * performance-cache-planner, implementation-synthesizer) with
 * authorities.can = ["read_files"] / ["read_files","run_commands"] on every
 * agent produced only markdown specs, yet the auditor said "close" and the
 * task was closed. enforceDeliveryGate is the deterministic backstop that
 * catches this regardless of what the LLM auditor decided.
 */

const existsSync = jest.fn();
const readFileSync = jest.fn();

jest.mock("node:fs", () => ({
  existsSync: (...a: unknown[]) => existsSync(...a),
  readFileSync: (...a: unknown[]) => readFileSync(...a),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunPaths: (namespaceId: string, orgId: string, runId: string) => ({
    runsDir: "/runs",
    runDir: `/runs/${runId}`,
    runJsonPath: `/runs/${runId}/run.json`,
    escalationsDir: `/runs/${runId}/escalations`,
  }),
}));

import { enforceDeliveryGate, chainHasDeliveryAgent } from "./completion-audit-delivery-gate";
import type { CompletionAudit } from "./completion-audit-schema";

function mockChainFile(chain: unknown) {
  existsSync.mockReturnValue(true);
  readFileSync.mockReturnValue(JSON.stringify(chain));
}

const READ_ONLY_CHAIN = {
  id: "git-ai-summary-endpoint-design-implementation",
  agents: [
    { id: "api-pattern-analyzer", authorities: { can: ["read_files", "run_commands"] } },
    { id: "change-categorization-designer", authorities: { can: ["read_files"] } },
    { id: "performance-cache-planner", authorities: { can: ["read_files"] } },
    { id: "implementation-synthesizer", authorities: { can: ["read_files"] } },
  ],
};

const DELIVERY_CHAIN = {
  id: "some-implementation-chain",
  agents: [
    { id: "analyzer", authorities: { can: ["read_files"] } },
    { id: "coder", authorities: { can: ["edit_files", "run_commands", "read_files"] } },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("chainHasDeliveryAgent", () => {
  it("false for a chain where every agent is read-only (the FEAT-014 shape)", () => {
    expect(chainHasDeliveryAgent(READ_ONLY_CHAIN)).toBe(false);
  });

  it("true when at least one agent has edit_files", () => {
    expect(chainHasDeliveryAgent(DELIVERY_CHAIN)).toBe(true);
  });

  it("false for null/malformed input", () => {
    expect(chainHasDeliveryAgent(null)).toBe(false);
    expect(chainHasDeliveryAgent({})).toBe(false);
    expect(chainHasDeliveryAgent({ agents: "not-an-array" })).toBe(false);
  });

  it("write_artifacts (the meta-generation chains' own authority) does NOT count as delivery", () => {
    expect(chainHasDeliveryAgent({
      agents: [{ id: "run-summary-generator", authorities: { can: ["read_files", "run_commands", "write_artifacts"] } }],
    })).toBe(false);
  });
});

describe("enforceDeliveryGate", () => {
  it("downgrades close -> decision for a 'feature' task when the chain had no write-authority agent", () => {
    mockChainFile(READ_ONLY_CHAIN);
    const audit: CompletionAudit = { verdict: "close", reason: "Spec is thorough and covers all acceptance criteria." };

    const gated = enforceDeliveryGate(audit, { issue_type: "feature" }, "default", "default", "run-1782109461935-37aa975b");

    expect(gated.verdict).toBe("decision");
    expect(gated.reason).toContain("no agent in the audited chain had file-write authority");
    expect(gated.decision?.prompt).toBeTruthy();
  });

  it("does the same for 'task' and 'bug' issue types", () => {
    mockChainFile(READ_ONLY_CHAIN);
    const audit: CompletionAudit = { verdict: "close", reason: "Looks done." };

    expect(enforceDeliveryGate(audit, { issue_type: "task" }, "default", "default", "run-1").verdict).toBe("decision");
    expect(enforceDeliveryGate(audit, { issue_type: "bug" }, "default", "default", "run-1").verdict).toBe("decision");
  });

  it("leaves close alone when the chain has a delivery agent", () => {
    mockChainFile(DELIVERY_CHAIN);
    const audit: CompletionAudit = { verdict: "close", reason: "Code shipped and verified." };

    const gated = enforceDeliveryGate(audit, { issue_type: "feature" }, "default", "default", "run-2");

    expect(gated).toBe(audit);
  });

  it("leaves close alone for epic/chore/decision issue types (planning-only work can legitimately close)", () => {
    mockChainFile(READ_ONLY_CHAIN);
    const audit: CompletionAudit = { verdict: "close", reason: "Epic breakdown complete." };

    expect(enforceDeliveryGate(audit, { issue_type: "epic" }, "default", "default", "run-3")).toBe(audit);
    expect(enforceDeliveryGate(audit, { issue_type: "chore" }, "default", "default", "run-3")).toBe(audit);
  });

  it("does not touch decision/retry verdicts", () => {
    mockChainFile(READ_ONLY_CHAIN);
    const decisionAudit: CompletionAudit = { verdict: "decision", reason: "x", decision: { prompt: "?" } };
    const retryAudit: CompletionAudit = { verdict: "retry", reason: "x", retry: { guidance: "y" } };

    expect(enforceDeliveryGate(decisionAudit, { issue_type: "feature" }, "default", "default", "run-4")).toBe(decisionAudit);
    expect(enforceDeliveryGate(retryAudit, { issue_type: "feature" }, "default", "default", "run-4")).toBe(retryAudit);
  });

  it("fails toward decision when chain.json is missing entirely (fail-safe, not fail-open)", () => {
    existsSync.mockReturnValue(false);
    const audit: CompletionAudit = { verdict: "close", reason: "Trust me." };

    const gated = enforceDeliveryGate(audit, { issue_type: "feature" }, "default", "default", "run-5");

    expect(gated.verdict).toBe("decision");
  });
});
