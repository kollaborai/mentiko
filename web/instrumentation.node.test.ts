const mockSetAuditLogger = jest.fn();
const mockExecAuditLog = jest.fn();

jest.mock("@/lib/middleware/audit-logger", () => ({
  setAuditLogger: mockSetAuditLogger,
}));

jest.mock("@/lib/api/audit-exec", () => ({
  execAuditLog: mockExecAuditLog,
}));

describe("node instrumentation audit setup", () => {
  beforeEach(() => {
    mockSetAuditLogger.mockReset();
    mockExecAuditLog.mockReset().mockResolvedValue("audit-id");
  });

  it("registers guest enforcement audit events with execAuditLog", async () => {
    const { initAuditLogger } = await import("./instrumentation.node");

    await initAuditLogger();

    expect(mockSetAuditLogger).toHaveBeenCalledTimes(1);
    const logger = mockSetAuditLogger.mock.calls[0][0] as (event: unknown) => Promise<void>;

    await logger({
      type: "guest_enforcement",
      event: {
        timestamp: "2026-05-06T00:06:02.069Z",
        userId: "default-user",
        role: "owner",
        method: "POST",
        pathname: "/api/tasks/auto-run",
        decision: "allowed",
        requestId: "req-1778025962069-lx7yenkqk",
        userAgent: "node",
        clientIp: "::ffff:127.0.0.1",
      },
    });

    expect(mockExecAuditLog).toHaveBeenCalledWith(
      "guest_enforcement",
      "allowed POST /api/tasks/auto-run for owner",
      expect.objectContaining({
        user_id: "default-user",
        role: "owner",
        method: "POST",
        pathname: "/api/tasks/auto-run",
        decision: "allowed",
        request_id: "req-1778025962069-lx7yenkqk",
        user_agent: "node",
      }),
      { ip: "::ffff:127.0.0.1" },
    );
  });
});
