import { render, screen, within } from "@testing-library/react";
import { FloatingWelcomePanel } from "./floating-welcome-panel";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@/lib/ui-context/namespace-context", () => ({
  useNamespace: () => ({ namespaceId: "default" }),
}));

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({ fetchWithNamespace: jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) }),
}));

jest.mock("@/lib/ui-context/workspace-context", () => ({
  useWorkspace: () => ({ workspaces: [] }),
}));

jest.mock("@/lib/ui-context/user-context", () => ({
  useUser: () => ({ user: { id: "user-1" } }),
}));

describe("FloatingWelcomePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
  });

  it("mounts the canonical SetupCenter — not the retired WelcomeWizard — as an accessible dialog (defect #5)", async () => {
    render(<FloatingWelcomePanel />);
    window.dispatchEvent(new CustomEvent("open-welcome-panel"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Labelled by SetupCenter's own heading id — proves the swap, not just "some dialog opened".
    expect(dialog).toHaveAttribute("aria-labelledby", "setup-center-heading");

    // SetupCenter's Step 0 copy (spec), not the legacy four-step wizard's.
    expect(within(dialog).getByRole("heading", { name: /first chain running/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Get Started/ })).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", async () => {
    render(<FloatingWelcomePanel />);
    window.dispatchEvent(new CustomEvent("open-welcome-panel"));

    const dialog = await screen.findByRole("dialog");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
