import { render, screen } from "@testing-library/react";
import { RunnerLineageLegend } from "@/components/docs/data-shapes-catalog";

describe("RunnerLineageLegend", () => {
  it("defines ownership and the typed coverage denominator", () => {
    render(<RunnerLineageLegend />);

    expect(screen.getByRole("heading", { name: "Runner Lineage" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("Runner v2")).toBeInTheDocument();
    expect(screen.getByText("Both")).toBeInTheDocument();
    expect(screen.getByText("Legacy shell")).toBeInTheDocument();
    expect(screen.getByText("Typed %")).toBeInTheDocument();
    expect(screen.getByText("Shell queue")).toBeInTheDocument();
    expect(screen.getByText(/direct \.sh reader, writer, type, or validator/i)).toBeInTheDocument();
    expect(screen.getByText(/does not count files, lines, or artifacts/i)).toBeInTheDocument();
  });
});
