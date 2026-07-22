import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarSegmentedControl,
  WorkflowSidebarToggleFilter,
  WorkflowSidebarVisibilityToggleGroup,
  matchesToggleFilter,
} from "./workflow-sidebar";

const STATUS_OPTS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "ready", label: "Ready" },
  { value: "closed", label: "Closed" },
];

describe("matchesToggleFilter", () => {
  it("treats an empty selection as 'all'", () => {
    expect(matchesToggleFilter([], "open")).toBe(true);
    expect(matchesToggleFilter([], "anything")).toBe(true);
  });
  it("matches only selected values when non-empty", () => {
    expect(matchesToggleFilter(["open", "closed"], "open")).toBe(true);
    expect(matchesToggleFilter(["open", "closed"], "ready")).toBe(false);
  });
});

describe("WorkflowSidebarToggleFilter", () => {
  it("marks the all-pill active when nothing is selected", () => {
    render(<WorkflowSidebarToggleFilter options={STATUS_OPTS} value={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "false");
  });

  it("adds a value to the selection, preserving option order", () => {
    const onChange = jest.fn();
    render(<WorkflowSidebarToggleFilter options={STATUS_OPTS} value={["closed"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    // canonical option order: open before closed
    expect(onChange).toHaveBeenCalledWith(["open", "closed"]);
  });

  it("removes an already-selected value (toggle off)", () => {
    const onChange = jest.fn();
    render(<WorkflowSidebarToggleFilter options={STATUS_OPTS} value={["open", "closed"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onChange).toHaveBeenCalledWith(["closed"]);
  });

  it("clears the selection when the all-pill is clicked", () => {
    const onChange = jest.fn();
    render(<WorkflowSidebarToggleFilter options={STATUS_OPTS} value={["open", "ready"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

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
