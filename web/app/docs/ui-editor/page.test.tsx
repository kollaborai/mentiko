import { fireEvent, render, screen, within } from "@testing-library/react";
import UiEditorPage from "./page";

jest.mock("@aliimam/icons", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        typeof name === "string" && name !== "__esModule" ? Icon : undefined,
    },
  );
});

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

describe("UiEditorPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the task card with the production default two-row layout", () => {
    render(<UiEditorPage />);

    const primary = screen.getByTestId("ui-editor-canvas-primary");
    const secondary = screen.getByTestId("ui-editor-canvas-secondary");

    expect(primary).toHaveTextContent(
      "Verify the uncommitted DNS designation fix is intact and isolated",
    );
    expect(primary).toHaveTextContent("2d ago");
    expect(secondary).toHaveTextContent("P0");
    expect(secondary).toHaveTextContent("TASK-003");
    expect(secondary).toHaveTextContent(
      "Working-Tree Fix Verification (Read-Only)",
    );
  });

  it("loads a different component preset from the top toolbar", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "Decision Card" }));

    expect(screen.getByTestId("ui-editor-canvas")).toHaveTextContent(
      "Choose the safer task-sidebar layout",
    );
    expect(screen.getByRole("heading", { name: "Decision Card" })).toBeInTheDocument();
  });

  it("adds an optional field to the selected cell and makes it visible", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add description" }));

    expect(screen.getByTestId("ui-editor-canvas")).toHaveTextContent(
      "Re-confirm the working-tree fix and its verification boundary.",
    );
    expect(screen.getByTestId("ui-editor-clean-preview")).toHaveTextContent(
      "Re-confirm the working-tree fix and its verification boundary.",
    );
  });

  it("saves and reloads a named template", () => {
    render(<UiEditorPage />);

    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "compact sidebar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "temporary edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "compact sidebar" }));

    expect(screen.getByTestId("ui-editor-canvas")).toHaveTextContent(
      "Verify the uncommitted DNS designation fix is intact and isolated",
    );
    expect(screen.getByTestId("ui-editor-canvas")).not.toHaveTextContent(
      "temporary edit",
    );
  });

  it("applies a full-color gradient theme to the preview", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "gradient" }));
    fireEvent.change(screen.getByLabelText("surface color"), {
      target: { value: "#101827" },
    });

    expect(
      screen.getByTestId("ui-editor-clean-preview").getAttribute("style"),
    ).toContain("linear-gradient");
  });

  it("exposes all 30 additional editor features", () => {
    render(<UiEditorPage />);

    for (const name of [
      "clone row",
      "merge up",
      "merge down",
      "reset row",
      "clone column",
      "equalize widths",
      "reverse columns",
      "reset column rows",
      "clone section",
      "reverse sections",
      "previous cell",
      "next cell",
      "reset style",
      "copy style",
      "paste style",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    for (const label of [
      "font family",
      "lowercase",
      "no wrap",
      "strike-through",
      "field background",
      "border color",
      "canvas alignment",
      "content vertical alignment",
      "clip content",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    for (const label of [
      "field padding x",
      "field padding y",
      "field radius",
      "minimum height",
      "card opacity",
      "border width",
    ]) {
      expect(
        screen.getByRole("slider", { name: new RegExp(label, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("moves the selected field between rows with the precise controls", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "Move time ago" }));
    fireEvent.click(screen.getByRole("button", { name: "Move field down" }));

    expect(
      within(screen.getByTestId("ui-editor-canvas-primary")).queryByText(
        "2d ago",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("ui-editor-canvas-secondary")).getByText(
        "2d ago",
      ),
    ).toBeInTheDocument();
  });

  it("supports dragging a field to a different row", () => {
    render(<UiEditorPage />);

    const dataTransfer = {
      effectAllowed: "none",
      setData: jest.fn(),
    };
    fireEvent.dragStart(screen.getByRole("button", { name: "Move time ago" }), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByRole("button", { name: "Move priority" }), {
      dataTransfer,
    });

    expect(
      within(screen.getByTestId("ui-editor-canvas-primary")).queryByText(
        "2d ago",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("ui-editor-canvas-secondary")).getByText(
        "2d ago",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the age unstruck when the sample task is completed", () => {
    render(<UiEditorPage />);

    expect(screen.getAllByText("2d ago")[0]).toHaveStyle({
      textDecoration: "none",
    });
    expect(
      screen.getAllByText(
        "Verify the uncommitted DNS designation fix is intact and isolated",
      )[0],
    ).toHaveStyle({ textDecoration: "line-through" });
  });

  it("adds sections and columns to the selected grid cell", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "add section" }));
    expect(screen.getByTestId("ui-editor-canvas-row-3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "add column" }));
    expect(screen.getByTestId("ui-editor-cell-3-2-1")).toBeInTheDocument();
  });

  it("inserts a row inside only the selected column", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "two-column" }));
    fireEvent.click(screen.getByTestId("ui-editor-cell-1-1-1"));
    fireEvent.click(screen.getByRole("button", { name: "insert row" }));

    expect(screen.getByTestId("ui-editor-cell-1-1-2")).toBeInTheDocument();
    expect(
      screen.queryByTestId("ui-editor-cell-1-2-2"),
    ).not.toBeInTheDocument();
  });

  it("clones and merges rows inside only the selected column", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "two-column" }));
    fireEvent.click(screen.getByTestId("ui-editor-cell-1-1-1"));
    fireEvent.click(screen.getByRole("button", { name: "clone row" }));

    expect(screen.getByTestId("ui-editor-cell-1-1-2")).toBeInTheDocument();
    expect(
      screen.queryByTestId("ui-editor-cell-1-2-2"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "merge up" }));
    expect(
      screen.queryByTestId("ui-editor-cell-1-1-2"),
    ).not.toBeInTheDocument();
  });

  it("copies a field style to another field", () => {
    render(<UiEditorPage />);

    fireEvent.change(screen.getByLabelText("font family"), {
      target: { value: "serif" },
    });
    fireEvent.click(screen.getByRole("button", { name: "copy style" }));
    fireEvent.click(screen.getByRole("button", { name: "Select time ago" }));
    fireEvent.click(screen.getByRole("button", { name: "paste style" }));

    expect(screen.getAllByText("2d ago")[0]).toHaveStyle({
      fontFamily: "Georgia, Cambria, serif",
    });
  });

  it("applies the new card and canvas controls to both previews", () => {
    render(<UiEditorPage />);

    fireEvent.change(
      screen.getByRole("slider", { name: /minimum height/i }),
      { target: { value: "160" } },
    );
    fireEvent.change(
      screen.getByRole("slider", { name: /card opacity/i }),
      { target: { value: "75" } },
    );
    fireEvent.change(screen.getByLabelText("canvas alignment"), {
      target: { value: "center" },
    });
    fireEvent.change(
      screen.getByLabelText("content vertical alignment"),
      { target: { value: "center" } },
    );

    const preview = screen.getByTestId("ui-editor-clean-preview");
    expect(preview).toHaveStyle({ minHeight: "160px", opacity: "0.75" });
    expect(preview.parentElement).toHaveClass("justify-center");
    expect(preview.firstElementChild).toHaveStyle({
      alignContent: "center",
    });
  });

  it("resizes the selected field font and supports undo", () => {
    render(<UiEditorPage />);

    fireEvent.change(screen.getByRole("slider", { name: /font size/i }), {
      target: { value: "20" },
    });
    expect(
      screen.getAllByText(
        "Verify the uncommitted DNS designation fix is intact and isolated",
      )[0],
    ).toHaveStyle({ fontSize: "20px" });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getAllByText(
        "Verify the uncommitted DNS designation fix is intact and isolated",
      )[0],
    ).toHaveStyle({ fontSize: "14px" });
  });

  it("can hide a field from the clean preview without removing it", () => {
    render(<UiEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "Select time ago" }));
    fireEvent.click(screen.getByLabelText("visible"));

    expect(
      within(screen.getByTestId("ui-editor-clean-preview")).queryByText(
        "2d ago",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("ui-editor-canvas")).getByText("2d ago"),
    ).toBeInTheDocument();
  });
});
