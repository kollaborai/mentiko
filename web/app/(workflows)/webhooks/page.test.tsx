import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WebhooksPage from "./page";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/lib/ui-context/workspace-context", () => ({
  useWorkspace: () => ({
    workspacePath: "/tmp/workspace",
  }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
}));

jest.mock("@/components/ui/wave-spinner", () => ({
  WaveSpinner: () => <div role="status">Loading</div>,
}));

jest.mock("@/components/shared/time-ago", () => ({
  TimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}));

jest.mock("@/components/webhooks/webhook-generate-dialog", () => ({
  WebhookGenerateDialog: () => null,
}));

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    AddFilled: Icon,
    Webhook: Icon,
    TrashFilled: Icon,
    EyeFilled: Icon,
    EyeSlashFilled: Icon,
    TickCircleFilled: Icon,
    CloseCircleFilled: Icon,
    ClockFilled: Icon,
    SendFilled: Icon,
    CopyFilled: Icon,
    RefreshFilled: Icon,
    MagicStarFilled: Icon,
    DirectSendFilled: Icon,
    LinkFilled: Icon,
    SearchNormalFilled: Icon,
    ArrowDown1Filled: Icon,
    ArrowRight1Filled: Icon,
  };
});

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

describe("WebhooksPage", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/webhooks/config" && !init) {
        return jsonResponse({
          data: {
            webhooks: [{
              id: "wh-1",
              name: "Deploy hook",
              url: "https://example.com/hook",
              events: ["chain_complete"],
              scope: { type: "chains", chainIds: ["deploy"] },
              active: true,
              createdAt: "2026-06-09T00:00:00.000Z",
              updatedAt: "2026-06-09T00:00:00.000Z",
              recentDeliveries: [],
            }],
          },
        });
      }
      if (url === "/api/webhooks/config" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          data: {
            webhook: {
              ...body,
              createdAt: "2026-06-09T00:00:00.000Z",
              updatedAt: "2026-06-09T00:01:00.000Z",
              recentDeliveries: [],
            },
          },
        });
      }
      return jsonResponse({});
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("lets existing outbound webhooks change selected-chain scope", async () => {
    render(<WebhooksPage />);

    await screen.findByDisplayValue("Deploy hook");
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const updateCall = mockFetchWithNamespace.mock.calls.find(
        ([url, init]) => url === "/api/webhooks/config" && init?.method === "PUT"
      );
      expect(updateCall).toBeTruthy();
      expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
        id: "wh-1",
        scope: { type: "all" },
      });
    });
  });
});
