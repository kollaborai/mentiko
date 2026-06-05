import { fireEvent, render, screen } from "@testing-library/react";
import AppearancePage from "./page";
import { USER_PREFERENCES_STORAGE_KEY } from "@/lib/ui/user-display-preferences";

jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: jest.fn() }),
}));

jest.mock("@/hooks/use-translation", () => ({
  useTranslations: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "settings.accent": "Accent",
        "settings.appearance": "Appearance",
        "settings.autoSave": "Auto save",
        "settings.autoSaveDesc": "Auto save description",
        "settings.behavior": "Behavior",
        "settings.floatingPanelTransparency": "Floating panel visibility",
        "settings.floatingPanelTransparencyDesc": "Floating panel visibility description",
        "settings.fontSize": "Font size",
        "settings.savePreferences": "Save preferences",
        "settings.streamOutput": "Stream output",
        "settings.streamOutputDesc": "Stream output description",
        "settings.theme": "Theme",
      };
      return labels[key] ?? key;
    },
  }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe("AppearancePage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists the floating panel transparency preference", () => {
    render(<AppearancePage />);

    const slider = screen.getByLabelText("Floating panel visibility");
    expect(slider).toHaveValue("90");
    expect(slider).toHaveAttribute("min", "80");
    expect(slider).toHaveAttribute("max", "100");

    fireEvent.change(slider, { target: { value: "85" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(JSON.parse(localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "{}")).toMatchObject({
      floatingPanelTransparency: 85,
    });
  });
});
