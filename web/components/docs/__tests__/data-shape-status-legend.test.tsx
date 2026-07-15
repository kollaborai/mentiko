import { render, screen } from "@testing-library/react";
import { DataShapeStatusLegend } from "@/components/docs/data-shapes-catalog";

describe("DataShapeStatusLegend", () => {
  it("defines every runtime catalog status in plain language", () => {
    render(<DataShapeStatusLegend />);

    expect(screen.getByRole("heading", { name: "Status Legend" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("Observed")).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();
    expect(screen.getByText("Drift")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(/every inspected record passed the canonical schema/i)).toBeInTheDocument();
    expect(screen.getByText(/no canonical schema was available/i)).toBeInTheDocument();
    expect(screen.getByText(/no matching artifact or inspectable record/i)).toBeInTheDocument();
    expect(screen.getByText(/failed validation, parsing, or inspection/i)).toBeInTheDocument();
    expect(screen.getByText(/no safe runtime sample is configured/i)).toBeInTheDocument();
  });
});
