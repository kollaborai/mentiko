import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrgsPage from "../page";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/orgs",
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({
    title,
    subtitle,
    actions,
  }: {
    title: string;
    subtitle: string;
    actions?: Array<{ label?: string; onClick?: () => void }>;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions?.map((action) => (
        <button key={action.label} type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </header>
  ),
}));

describe("OrgsPage", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates an organization and refreshes the organization list", async () => {
    const createdOrg = {
      id: "org-1",
      name: "Acme Labs",
      slug: "acme-labs",
      memberCount: 1,
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { orgs: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { org: createdOrg } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { orgs: [createdOrg], org: createdOrg } }),
      });

    render(<OrgsPage />);

    await screen.findByText("No organizations yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Organization" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Acme Labs");

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Slug")).toHaveValue("acme-labs");
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Acme Labs", slug: "acme-labs" }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("Acme Labs").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("acme-labs").length).toBeGreaterThan(0);
  });

  it("offers a new organization action when orgs already exist", async () => {
    const existingOrg = {
      id: "org-1",
      name: "Marco's org",
      slug: "default",
      memberCount: 5,
      createdAt: "2026-05-04T12:00:00.000Z",
      updatedAt: "2026-05-04T12:00:00.000Z",
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { orgs: [existingOrg], org: existingOrg } }),
    });

    render(<OrgsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Marco's org").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "New Organization" })).toBeInTheDocument();
  });
});
