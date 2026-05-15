import { act, fireEvent, render, screen } from "@testing-library/react";
import { FloatingAppPanels } from "../floating-app-panels";
import { OPEN_FLOATING_APP_PANEL_EVENT } from "@/lib/floating-app-panel-routing";

jest.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => {
      const htmlProps: Record<string, unknown> = {};
      const animate = props.animate;
      for (const [key, value] of Object.entries(props)) {
        if (!["initial", "animate", "exit", "transition"].includes(key)) {
          htmlProps[key] = value;
        }
      }
      if (animate && typeof animate === "object") {
        htmlProps["data-motion-animate"] = JSON.stringify(animate);
      }
      return <div {...htmlProps}>{children}</div>;
    },
  },
}));

jest.mock("@aliimam/icons", () => {
  const icon = (name: string) =>
    function MockIcon({ className }: { className?: string }) {
      return <svg data-testid={`icon-${name}`} className={className} />;
    };
  return {
    RouteSquareFilled: icon("route-square"),
    CloseCircleFilled: icon("close-circle"),
    AttachCircleFilled: icon("attach-circle"),
    MaximizeFilled: icon("maximize"),
  };
});

describe("FloatingAppPanels", () => {
  it("opens a floating iframe panel from the global panel event", () => {
    render(<FloatingAppPanels />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/runs?runId=abc", title: "Runs" },
      }));
    });

    const iframe = screen.getByTitle("Runs panel") as HTMLIFrameElement;
    expect(iframe).toHaveAttribute("src", "/runs?runId=abc&surface=panel");
    const panel = document.querySelector("[data-floating-app-panel]");
    expect(JSON.parse(panel?.getAttribute("data-motion-animate") ?? "{}")).toEqual(
      expect.objectContaining({ opacity: 1 }),
    );
    expect(panel?.className).toContain("bg-[#0e0e0e]/72");
    expect(panel?.className).toContain("dark:bg-[#060606]/72");
    expect(panel?.className).toContain("backdrop-blur-[1px]");
    expect(panel?.className).not.toContain("backdrop-blur-xl");
    expect(iframe.className).toContain("absolute");
    expect(iframe.className).toContain("bg-transparent");
    expect(iframe.className).not.toContain("bg-background");
    expect(document.querySelector("[data-floating-app-panel-grip]")).toHaveStyle({
      background:
        "linear-gradient(to bottom, rgba(6,6,6,0.9) 0%, rgba(6,6,6,0.7) 46%, rgba(6,6,6,0) 100%)",
    });
    expect(document.querySelector("[data-floating-app-panel-shine]")?.className).toContain("z-[60]");
    expect(document.querySelector("[data-floating-app-panel-shine]")).toHaveStyle({
      backgroundImage:
        "radial-gradient(transparent, transparent, rgba(255,255,255,0.16), rgba(255,255,255,0.5), rgba(255,255,255,0.18), transparent, transparent)",
    });
    expect(screen.getByTestId("icon-route-square")).toHaveClass("text-white/55");
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(document.querySelector("[data-floating-app-desktop]")).toBeInTheDocument();
  });

  it("opens different floating routes as separate panels", () => {
    render(<FloatingAppPanels />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/runs", title: "Runs" },
      }));
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/tasks", title: "Tasks" },
      }));
    });

    expect(screen.getByTitle("Runs panel")).toHaveAttribute("src", "/runs?surface=panel");
    expect(screen.getByTitle("Tasks panel")).toHaveAttribute("src", "/tasks?surface=panel");
    expect(document.querySelectorAll("[data-floating-app-panel]")).toHaveLength(2);
  });

  it("focuses an existing panel instead of duplicating the same route", () => {
    render(<FloatingAppPanels />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/runs", title: "Runs" },
      }));
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/runs", title: "Runs" },
      }));
    });

    expect(screen.getAllByTitle("Runs panel")).toHaveLength(1);
    expect(document.querySelectorAll("[data-floating-app-panel]")).toHaveLength(1);
  });

  it("keeps restored panel geometry inside the visible viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    localStorage.setItem(
      "floating-app-panel-geometry",
      JSON.stringify({ x: 940, y: 620, w: 900, h: 620 }),
    );

    render(<FloatingAppPanels />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/tasks", title: "Tasks" },
      }));
    });

    const panel = document.querySelector("[data-floating-app-panel]") as HTMLElement;
    expect(panel.style.left).toBe("84px");
    expect(panel.style.top).toBe("64px");
    expect(panel.style.width).toBe("900px");
    expect(panel.style.height).toBe("620px");
  });

  it("closes the active panel without navigating the page", () => {
    render(<FloatingAppPanels />);

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
        detail: { href: "/settings", title: "Settings" },
      }));
    });

    fireEvent.click(screen.getByTitle("Close panel"));

    expect(screen.queryByTitle("Settings panel")).not.toBeInTheDocument();
  });
});
