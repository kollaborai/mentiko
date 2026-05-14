import { act, fireEvent, render, screen } from "@testing-library/react";
import { FloatingAppPanels } from "../floating-app-panels";
import { OPEN_FLOATING_APP_PANEL_EVENT } from "@/lib/floating-app-panel-routing";

jest.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => {
      const htmlProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!["initial", "animate", "exit", "transition"].includes(key)) {
          htmlProps[key] = value;
        }
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
