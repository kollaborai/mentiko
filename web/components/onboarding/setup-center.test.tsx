import { render, screen, waitFor } from "@testing-library/react";
import { SetupCenter } from "./setup-center";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

jest.mock("@/components/onboarding/welcome-wizard", () => ({
  WelcomeWizard: () => <div data-testid="welcome-wizard">wizard</div>,
}));

describe("SetupCenter", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    push.mockClear();
  });

  it("renders canonical milestone rail and partial progress", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: {
        provider: { status: "ready" },
        workspace: { status: "ready" },
        readiness: { status: "not_started" },
        sampleRun: { status: "not_started" },
      } }),
    });

    render(<SetupCenter />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2 of 4 milestones complete")).toBeInTheDocument());
    const readiness = screen.getByRole("button", { name: /Check that everything works/ });
    expect(readiness).toHaveAttribute("aria-current", "step");
    readiness.click();
    expect(push).toHaveBeenCalledWith("/settings/agent-health?from=setup");
    expect(screen.getByTestId("welcome-wizard")).toBeInTheDocument();
  });

  it("shows a repairable error when progress cannot load", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    render(<SetupCenter />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to load setup progress"));
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });
});
