/**
 * @jest-environment node
 */

import { join } from "node:path";

const existsSync = jest.fn();
const mkdirSync = jest.fn();
const writeFileSync = jest.fn();

jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
  readFileSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

jest.mock("path", () => jest.requireActual("path"));
jest.mock("@/lib/config", () => ({
  orgPath: (_namespaceId: string, _orgId: string, ...segments: string[]) => join("/tmp/mentiko", ...segments),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));
jest.mock("@/lib/auth/rbac-auth", () => ({ requirePermission: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/system/version-utils", () => ({ getDefaultVersion: jest.fn(() => "1.0.0") }));
jest.mock("@/lib/validators", () => ({ validateChain: jest.fn(() => ({ valid: true, errors: [] })) }));
jest.mock("@/lib/api/audit-exec", () => ({ execAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/api/audit-queue", () => ({ addAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/api-errors", () => ({
  BadRequest: class BadRequest extends Error {},
  ValidationError: class ValidationError extends Error {
    details: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.details = details;
    }
  },
}));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(handler: T) => handler,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => ({ success: true, data }) }),
}));
jest.mock("@/lib/agents/agent-loader", () => ({
  resolveChainAgents: jest.fn(() => { throw new Error("inline agent remains inline"); }),
}));
jest.mock("@/lib/agents/mcp-task-tool-contract", () => ({
  normalizeMcpTaskToolDeclarations: <T>(agent: T) => agent,
}));
const mockIsGeneratedChainContract = jest.fn(() => false);
jest.mock("@/lib/chains/generated-chain-delivery-contract", () => ({
  ...jest.requireActual("@/lib/chains/generated-chain-delivery-contract"),
  isGeneratedChainContract: (...args: unknown[]) => mockIsGeneratedChainContract(...args as []),
}));

// The route's generated-chain path is a thin adapter over THE acceptance
// service (B3); mock that boundary. The service itself is covered by
// lib/chains/generated-chain-acceptance.test.ts against a real fs root.
const mockAcceptGeneratedChain = jest.fn();
const mockPersistAcceptedManifest = jest.fn();
jest.mock("@/lib/chains/generated-chain-acceptance", () => ({
  ...jest.requireActual("@/lib/chains/generated-chain-acceptance"),
  acceptGeneratedChain: (...args: unknown[]) => mockAcceptGeneratedChain(...args),
  persistAcceptedManifest: (...args: unknown[]) => mockPersistAcceptedManifest(...args),
}));

import { POST } from "./route";

describe("POST /api/chains/save inline agents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    existsSync.mockReturnValue(false);
  });

  it("canonicalizes generated authority shorthand before persisting an extracted agent", async () => {
    const request = new Request("http://localhost/api/chains/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "generated-chain",
        chain: {
          name: "generated-chain",
          agents: [{
            id: "generated-reader",
            name: "Generated Reader",
            prompt: "Read the requested files.",
            triggers: ["start"],
            emits: "reader-complete",
            authorities: ["read_files", "run_commands"],
          }],
        },
      }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    const agentWrite = writeFileSync.mock.calls.find(([target]) =>
      target === "/tmp/mentiko/agents/generated-reader/agent.json",
    );
    expect(agentWrite).toBeDefined();
    expect(JSON.parse(agentWrite![1] as string)).toMatchObject({
      authorities: {
        can: ["read_files", "run_commands"],
        needs_approval: [],
      },
    });
  });

  it("drops a fan_in join agent from its own fan_out worker list before persisting", async () => {
    const request = new Request("http://localhost/api/chains/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "fanin-chain",
        chain: {
          name: "fanin-chain",
          version: "1.0.0",
          agents: [{ $ref: "orchestrator" }, { $ref: "agent-a" }, { $ref: "aggregator" }],
          branches: {
            "analysis-start": {
              fan_out: ["agent-a", "aggregator", "aggregator"],
              fan_in: "aggregator",
              wait_for: "all",
            },
          },
        },
      }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    const chainWrite = writeFileSync.mock.calls.find(([target]) =>
      target === "/tmp/mentiko/chains/fanin-chain/chain.json",
    );
    expect(chainWrite).toBeDefined();
    const persisted = JSON.parse(chainWrite![1] as string);
    // every occurrence of the join agent removed from fan_out; fan_in preserved
    expect(persisted.branches["analysis-start"].fan_out).toEqual(["agent-a"]);
    expect(persisted.branches["analysis-start"].fan_in).toBe("aggregator");
  });

  it("rewrites branch targets when an inline agent is collision-suffixed during persistence", async () => {
    existsSync.mockImplementation((target: string) =>
      target === "/tmp/mentiko/agents/final-verifier/agent.json",
    );
    const request = new Request("http://localhost/api/chains/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "collision-chain",
        chain: {
          name: "collision-chain",
          version: "1.0.0",
          agents: [
            {
              id: "worker",
              name: "Worker",
              prompt: "Do the work.",
              triggers: ["chain_start"],
              emits: "work-complete",
              on_error: "final-verifier",
              on_timeout: "final-verifier",
            },
            {
              id: "final-verifier",
              name: "Final Verifier",
              prompt: "Verify the work.",
              triggers: ["work-complete"],
              emits: "verification-complete",
            },
          ],
          branches: {
            "work-complete": "final-verifier",
            "verification-complete": {
              conditions: [
                { if: "accepted", then: "stop" },
                { if: "retry", then: "worker" },
              ],
              on_error: "final-verifier",
            },
          },
          routing: {
            error_handler: "final-verifier",
            timeout_agent: "final-verifier",
            timeout_handler: "worker",
          },
        },
      }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    const chainWrite = writeFileSync.mock.calls.find(([target]) =>
      target === "/tmp/mentiko/chains/collision-chain/chain.json",
    );
    expect(chainWrite).toBeDefined();
    const persisted = JSON.parse(chainWrite![1] as string);
    expect(persisted.agents).toEqual([
      { $ref: "worker", triggers: ["chain_start"], emits: "work-complete" },
      { $ref: "final-verifier-2", triggers: ["work-complete"], emits: "verification-complete" },
    ]);
    const workerWrite = writeFileSync.mock.calls.find(([target]) =>
      target === "/tmp/mentiko/agents/worker/agent.json",
    );
    expect(workerWrite).toBeDefined();
    expect(JSON.parse(workerWrite![1] as string)).toMatchObject({
      on_error: "final-verifier-2",
      on_timeout: "final-verifier-2",
    });
    expect(persisted.branches).toEqual({
      "work-complete": "final-verifier-2",
      "verification-complete": {
        conditions: [
          { if: "accepted", then: "stop" },
          { if: "retry", then: "worker" },
        ],
        on_error: "final-verifier-2",
      },
    });
    expect(persisted.routing).toEqual({
      error_handler: "final-verifier-2",
      timeout_agent: "final-verifier-2",
      timeout_handler: "worker",
    });
  });
});

// B3 (chain-contract-plan-of-record.md): the save door is an adapter over
// THE acceptance service — rejections carry its typed envelope, acceptance
// persists the manifest chain + digest and skips the inline-agent migration
// the service already performed.
describe("POST /api/chains/save generated-chain acceptance", () => {
  const { buildGeneratedChainRejectionEnvelope } =
    jest.requireActual("@/lib/chains/generated-chain-rejections");
  const { GeneratedChainRejectedError } =
    jest.requireActual("@/lib/chains/generated-chain-acceptance");

  const authoredChain = {
    name: "generated-chain",
    metadata: { generated_chain_contract: { version: 1, mode: "research", acceptance_criteria: "x" } },
    agents: [{ id: "observer", name: "Observer", prompt: "Observe.", triggers: ["start"], emits: "observed" }],
  };

  const saveRequest = () => new Request("http://localhost/api/chains/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "generated-chain", chain: authoredChain }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    existsSync.mockReturnValue(false);
    mockIsGeneratedChainContract.mockReturnValue(true);
  });

  it("persists the accepted manifest chain and records the digest binding", async () => {
    const manifestChain = {
      ...authoredChain,
      agents: [{ $ref: "observer", triggers: ["start"], emits: "observed" }],
    };
    mockAcceptGeneratedChain.mockReturnValue({
      authoredChain,
      manifestChain,
      digest: "sha256:accepted",
      contractVersion: 1,
      acceptanceRevision: "test-rev",
      warnings: [],
      createdAgents: [{ id: "observer", name: "Observer" }],
      extractedCount: 1,
    });

    const response = await POST(saveRequest() as never);

    expect(response.status).toBe(200);
    expect(mockAcceptGeneratedChain).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: "default",
      orgId: "default",
      phase: "save",
    }));
    const chainWrite = writeFileSync.mock.calls.find(([target]) =>
      String(target).endsWith("/chains/generated-chain/chain.json"),
    );
    expect(chainWrite).toBeDefined();
    const persisted = JSON.parse(chainWrite![1] as string);
    // the service's materialized chain is persisted, version-stamped
    expect(persisted.agents).toEqual(manifestChain.agents);
    expect(persisted.version).toBe("1.0.0");
    expect(mockPersistAcceptedManifest).toHaveBeenCalledWith(
      "default",
      "default",
      "generated-chain",
      expect.objectContaining({
        digest: expect.stringMatching(/^sha256:/),
        manifestChain: expect.objectContaining({ version: "1.0.0" }),
      }),
    );
    // no second inline-agent migration: only the chain.json write happened
    const agentWrites = writeFileSync.mock.calls.filter(([target]) =>
      String(target).includes("/agents/"),
    );
    expect(agentWrites).toEqual([]);
  });

  it("maps a service rejection to the typed 422 envelope", async () => {
    const envelope = buildGeneratedChainRejectionEnvelope({
      phase: "save",
      chain: authoredChain,
      errors: ["the last generated-chain agent must declare final_verifier: true"],
    });
    mockAcceptGeneratedChain.mockImplementation(() => {
      throw new GeneratedChainRejectedError([envelope.message], envelope);
    });

    await expect(POST(saveRequest() as never)).rejects.toMatchObject({
      message: "Invalid generated chain delivery contract",
      details: {
        errors: [envelope.message],
        rejection: expect.objectContaining({
          phase: "save",
          deterministic: true,
          artifact_hash: expect.stringMatching(/^sha256:/),
        }),
      },
    });
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(mockPersistAcceptedManifest).not.toHaveBeenCalled();
  });

  it("marks a ledger-answered duplicate so retry loops stop immediately", async () => {
    const envelope = buildGeneratedChainRejectionEnvelope({
      phase: "save",
      chain: authoredChain,
      errors: ["the last generated-chain agent must declare final_verifier: true"],
    });
    mockAcceptGeneratedChain.mockImplementation(() => {
      throw new GeneratedChainRejectedError([envelope.message], envelope, true);
    });

    await expect(POST(saveRequest() as never)).rejects.toMatchObject({
      details: expect.objectContaining({ duplicate: true }),
    });
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
