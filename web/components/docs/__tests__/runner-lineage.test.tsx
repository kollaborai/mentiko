import { render, screen } from "@testing-library/react";
import { RunnerLineageLegend } from "@/components/docs/data-shapes-catalog";

describe("RunnerLineageLegend", () => {
  it("defines ownership and the typed coverage denominator", () => {
    render(<RunnerLineageLegend />);

    expect(screen.getByRole("heading", { name: "Runner Lineage" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Runner v2")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getByText("Legacy shell")).toBeInTheDocument();
    expect(screen.getByText("Typed %")).toBeInTheDocument();
    expect(screen.getByText(/does not count files, lines, or artifacts/i)).toBeInTheDocument();
  });
});
