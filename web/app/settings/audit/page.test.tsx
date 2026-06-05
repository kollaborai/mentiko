import { render, screen } from "@testing-library/react";
import AuditTrailPage from "./page";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/ui-context/namespace-context", () => ({
  useNamespace: () => ({ namespaceId: "default" }),
}));

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  ),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    ArrowDown2Filled: Icon,
    ArrowUp2Filled: Icon,
    DocumentDownloadFilled: Icon,
    DocumentTextFilled: Icon,
    RefreshFilled: Icon,
    ShieldTickFilled: Icon,
  };
});

describe("AuditTrailPage", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
  });

  it("renders audit entries from the wrapped apiSuccess payload", async () => {
    mockFetchWithNamespace.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          count: 1,
          logs: [
            {
              id: "audit_1",
              timestamp: "2026-05-06T00:06:02.069Z",
              event_type: "guest_enforcement",
              description: "Allowed POST /api/tasks/auto-run",
              user: "default-user",
              source: "middleware",
              ip: "127.0.0.1",
            },
          ],
        },
        requestId: "req_test",
      }),
    });

    render(<AuditTrailPage />);

    expect((await screen.findAllByText("guest_enforcement")).length).toBeGreaterThan(0);
    expect(screen.getByText("Allowed POST /api/tasks/auto-run")).toBeInTheDocument();
    expect(screen.getByText("default-user")).toBeInTheDocument();
  });

  it("shows the restricted state when the audit API returns 403", async () => {
    mockFetchWithNamespace.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: "Forbidden",
        message: "Role 'member' does not have permission 'view_audit'",
      }),
    });

    render(<AuditTrailPage />);

    expect(await screen.findByText(/view_audit/)).toBeInTheDocument();
    expect(screen.getByText(/owners and admins/i)).toBeInTheDocument();
  });
});
