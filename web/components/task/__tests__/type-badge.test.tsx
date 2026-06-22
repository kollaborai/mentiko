/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { TypeBadge } from "../type-badge";

describe("TypeBadge", () => {
  it("uses the decision icon for decision tasks", () => {
    render(<TypeBadge type="decision" />);

    expect(screen.getByTestId("icon-JudgeFilled")).toBeInTheDocument();
    expect(screen.getByText("DEC")).toBeInTheDocument();
  });
});
