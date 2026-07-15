import { render, screen } from "@testing-library/react";
import { TerminalIcon } from "../terminal-icon";

jest.mock("@aliimam/icons", () => ({
  CommandSquareFilled: ({ className }: { className?: string }) => (
    <svg data-testid="terminal-icon" className={className} />
  ),
}));

describe("TerminalIcon", () => {
  it("renders the shared terminal glyph", () => {
    render(<TerminalIcon className="h-4 w-4" />);

    expect(screen.getByTestId("terminal-icon")).toHaveClass("h-4 w-4");
  });
});
