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
  ValidationError: class ValidationError extends Error {},
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
jest.mock("@/lib/chains/generated-chain-delivery-contract", () => ({
  isGeneratedChainContract: jest.fn(() => false),
  validateGeneratedChainDeliveryContract: jest.fn(() => []),
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
});
