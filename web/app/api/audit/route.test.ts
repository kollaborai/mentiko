/** @jest-environment node */

import type { NextRequest } from "next/server";

const mockRequirePermission = jest.fn();
const mockExecAuditLog = jest.fn();
const mockExecAuditQuery = jest.fn();

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

jest.mock("@/lib/api/audit-exec", () => ({
  execAuditLog: (...args: unknown[]) => mockExecAuditLog(...args),
  execAuditQuery: (...args: unknown[]) => mockExecAuditQuery(...args),
}));

import { GET, POST } from "./route";

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-forwarded-for": "192.0.2.10",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
}

describe("/api/audit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequirePermission.mockResolvedValue(null);
    mockExecAuditQuery.mockResolvedValue(JSON.stringify([
      { id: "audit-1", event_type: "decision_updated", user: "mentiko-server" },
    ]));
  });

  it("rejects a view_audit caller attempting to append a client-supplied event", async () => {
    const auditReadRequest = makeRequest("GET", "http://localhost/api/audit");
    const readResponse = await GET(auditReadRequest);
    expect(readResponse.status).toBe(200);

    const request = makeRequest("POST", "http://localhost/api/audit", {
      eventType: "forged_approval",
      description: "A client supplied event",
      user: "victim",
    });

    const response = await POST(request);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(mockExecAuditLog).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(auditReadRequest, "view_audit");
  });

  it("keeps audit queries available to view_audit readers", async () => {
    const request = makeRequest("GET", "http://localhost/api/audit?user=mentiko-server&limit=10");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequirePermission).toHaveBeenCalledWith(request, "view_audit");
    expect(mockExecAuditQuery).toHaveBeenCalledWith(
      { filterType: "user", filterValue: "mentiko-server", since: "", limit: "10" },
      { ip: "192.0.2.10" },
    );
    expect(body.data.logs).toEqual([
      { id: "audit-1", event_type: "decision_updated", user: "mentiko-server" },
    ]);
  });
});
