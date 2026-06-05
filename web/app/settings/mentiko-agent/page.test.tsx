import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MentikoAgentSettingsPage from "./page";
import { FONT_SCALE_DEFAULT, useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    AddFilled: Icon,
    CloseCircleFilled: Icon,
    CloudConnectionFilled: Icon,
    MagicStarFilled: Icon,
    RefreshFilled: Icon,
    Setting2Filled: Icon,
    ShieldTickFilled: Icon,
    TickCircleFilled: Icon,
    TrashFilled: Icon,
  };
});

jest.mock(
  "@aliimam/logos",
  () => {
    const Logo = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
    return {
      ClaudeAI: Logo,
      GoogleGemini: Logo,
      OpenAI: Logo,
    };
  },
  { virtual: true },
);

describe("MentikoAgentSettingsPage font settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useKollaborBarStore.getState().setFontScale(FONT_SCALE_DEFAULT);
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockImplementation((url: string) => {
        if (url.includes("/api/secrets")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { secrets: [] } }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ profiles: [], active: "", count: 0 }) });
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("persists the large agent text preset from settings", async () => {
    render(<MentikoAgentSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Large" }));

    expect(useKollaborBarStore.getState().fontScale).toBe(1.2);
    expect(localStorage.getItem("mentiko-kollabor-font-scale")).toBe("1.2");
    await waitFor(() => expect(screen.getByText("120%")).toBeInTheDocument());
  });

  it("keeps profile action buttons the same size", async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch.mockImplementation((url: string) => {
      if (url.includes("/api/secrets")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { secrets: [] } }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          profiles: [
            {
              name: "claude",
              provider: "anthropic",
              model: "claude-sonnet-4-6",
              temperature: 0.7,
              max_tokens: null,
              timeout: 0,
              description: "",
              streaming: true,
              supports_tools: true,
            },
          ],
          active: "default",
          count: 1,
        }),
      });
    });

    render(<MentikoAgentSettingsPage />);

    const setActive = await screen.findByRole("button", { name: "Set Active" });
    const test = screen.getByRole("button", { name: "Test" });
    const edit = screen.getByRole("button", { name: "Edit" });

    expect(setActive).toHaveClass("w-20", "h-7", "text-xs");
    expect(test).toHaveClass("w-20", "h-7", "text-xs");
    expect(edit).toHaveClass("w-20", "h-7", "text-xs");
  });
});
