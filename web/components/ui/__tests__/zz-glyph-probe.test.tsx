import { render } from "@testing-library/react";
import { Code1Filled, CommandSquareFilled } from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";

const d = (ui: React.ReactElement) =>
  [...render(ui).container.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");

it("nav TerminalIcon glyph identity", () => {
  const actual = d(<TerminalIcon />);
  console.log("TerminalIcon        :", actual.slice(0, 60));
  console.log("Code1Filled         :", d(<Code1Filled />).slice(0, 60));
  console.log("CommandSquareFilled :", d(<CommandSquareFilled />).slice(0, 60));
  console.log("matches Code1Filled?        ", actual === d(<Code1Filled />));
  console.log("matches CommandSquareFilled?", actual === d(<CommandSquareFilled />));
  expect(actual).toBe(d(<Code1Filled />));
  expect(actual).not.toBe(d(<CommandSquareFilled />));
});
