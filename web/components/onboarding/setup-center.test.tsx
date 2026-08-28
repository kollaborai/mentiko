import { render, screen, waitFor } from "@testing-library/react";
import { SetupCenter } from "./setup-center";

jest.mock("@/components/onboarding/welcome-wizard", () => ({
  WelcomeWizard: () => <div data-testid="welcome-wizard">wizard</div>,
}));

describe("SetupCenter", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
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
    expect(screen.getByRole("button", { name: /Check that everything works/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("welcome-wizard")).toBeInTheDocument();
  });

  it("shows a repairable error when progress cannot load", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    render(<SetupCenter />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to load setup progress"));
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });
});
