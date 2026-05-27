import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarSegmentedControl,
  WorkflowSidebarVisibilityToggleGroup,
} from "./workflow-sidebar";

describe("workflow sidebar panel surfaces", () => {
  it("exposes shared hooks for panel-surface transparency", () => {
    render(
      <WorkflowSidebarPane>
        <WorkflowSidebarFilters>
          <WorkflowSidebarSegmentedControl
            options={[{ value: "all", label: "All" }]}
            value="all"
            onChange={() => {}}
          />
        </WorkflowSidebarFilters>
        <WorkflowSidebarItem>Task row</WorkflowSidebarItem>
      </WorkflowSidebarPane>,
    );

    expect(screen.getByTestId("workflow-sidebar-pane")).toHaveAttribute("data-workflow-sidebar-pane");
    expect(screen.getByTestId("workflow-sidebar-filters")).toHaveAttribute("data-workflow-sidebar-filters");
    expect(screen.getByTestId("workflow-sidebar-segmented-control")).toHaveAttribute(
      "data-workflow-sidebar-control",
    );
    expect(screen.getByTestId("workflow-sidebar-item")).toHaveAttribute("data-workflow-sidebar-item");
  });

  it("renders independent visibility toggles with pressed state and counts", () => {
    const onToggle = jest.fn();

    render(
      <WorkflowSidebarVisibilityToggleGroup
        options={[
          { value: "user", label: "User", active: true, count: 4 },
          { value: "system", label: "System", active: false, count: 7 },
        ]}
        onToggle={onToggle}
      />,
    );

    const group = screen.getByTestId("workflow-sidebar-visibility-toggle");
    const userButton = screen.getByTestId("visibility-toggle-user");
    const systemButton = screen.getByTestId("visibility-toggle-system");

    expect(group).toHaveAttribute("data-workflow-sidebar-control");
    expect(userButton).toHaveAttribute("aria-pressed", "true");
    expect(systemButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();

    fireEvent.click(systemButton);

    expect(onToggle).toHaveBeenCalledWith("system");
  });

  it("tunes workflow sidebar chrome only inside floating panel documents", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toContain("html[data-floating-panel-surface] [data-workflow-sidebar-pane]");
    expect(css).toContain("html[data-floating-panel-surface] main#main-content");
    expect(css).toContain("html[data-floating-panel-surface] [data-workflow-sidebar-filters]");
    expect(css).toContain("html[data-floating-panel-surface] [data-workflow-sidebar-item]");
    expect(css).toContain("html[data-floating-panel-surface] [data-workflow-sidebar-control]");
    expect(css).toContain("var(--muted) var(--floating-panel-pane-mix), transparent) !important");
    expect(css).toContain("var(--background) var(--floating-panel-body-mix), transparent) !important");
    expect(css).toContain("var(--accent) var(--floating-panel-filters-mix), transparent) !important");
    expect(css).toContain("var(--card) var(--floating-panel-item-mix), transparent) !important");
  });
});
