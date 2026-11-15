/** @jest-environment node */

const mockRequirePermission = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
}));
jest.mock("@/lib/config", () => {
  const path = jest.requireActual("node:path");
  return {
    nsPath: (namespaceId: string, ...segments: string[]) => path.join(
      globalThis.__MENTIKO_AUDIT_EXPLAIN_ROOT__,
      "namespaces",
      namespaceId,
      ...segments,
    ),
  };
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";

declare global {
  var __MENTIKO_AUDIT_EXPLAIN_ROOT__: string;
}

interface ExplainResponse {
  data: {
    totalAuditEntries: number;
    explanations: Array<{ auditEntries: Array<{ id?: string; event_type?: string }> }>;
  };
}

function writeRun(root: string, runId: string): void {
  const runDir = join(root, "namespaces", "acme", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({
    id: runId,
    chainName: "approval-chain",
    agents: [{ id: "reviewer", name: "Reviewer" }],
  }));
}

function writeAuditLog(root: string, entries: Array<Record<string, unknown>>): void {
  const auditDir = join(root, "namespaces", "acme", "audit");
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(join(auditDir, "audit.log"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

async function explain(runId: string): Promise<{ response: Response; body: ExplainResponse }> {
  const response = await GET(new Request(`http://localhost/api/audit/explain?runId=${runId}`) as never);
  return { response: response as unknown as Response, body: await response.json() as ExplainResponse };
}

describe("GET /api/audit/explain", () => {
  let root: string;

  beforeEach(() => {
    jest.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "mentiko-audit-explain-"));
    globalThis.__MENTIKO_AUDIT_EXPLAIN_ROOT__ = root;
    mockRequirePermission.mockResolvedValue(null);
    mockGetNamespaceIdFromRequest.mockResolvedValue("acme");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("includes chain start and completion events correlated through metadata.run_id", async () => {
    const runId = "run-chain-1";
    writeRun(root, runId);
    writeAuditLog(root, [
      {
        id: "audit_start_1",
        event_type: "chain_start",
        description: "Started approval chain",
        metadata: { run_id: runId, chain_name: "approval-chain" },
      },
      {
        id: "audit_complete_1",
        event_type: "chain_complete",
        description: "Completed approval chain",
        metadata: { run_id: runId, chain_name: "approval-chain" },
      },
      {
        id: "audit_without_run_id",
        event_type: "info",
        description: "No run correlation",
        metadata: {},
      },
    ]);

    const { response, body } = await explain(runId);

    expect(response.status).toBe(200);
    expect(body.data.totalAuditEntries).toBe(2);
    expect(body.data.explanations[0].auditEntries.map((entry) => entry.event_type)).toEqual([
      "chain_start",
      "chain_complete",
    ]);
  });

  it("does not use an audit event id as a run id", async () => {
    const runId = "audit_event_1";
    writeRun(root, runId);
    writeAuditLog(root, [{
      id: runId,
      event_type: "chain_start",
      description: "Event with no run correlation",
      metadata: {},
    }]);

    const { response, body } = await explain(runId);

    expect(response.status).toBe(200);
    expect(body.data.totalAuditEntries).toBe(0);
    expect(body.data.explanations[0].auditEntries).toEqual([]);
  });
});
