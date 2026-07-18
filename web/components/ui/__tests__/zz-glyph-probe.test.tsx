import { render } from "@testing-library/react";
import { TerminalIcon } from "@/components/ui/terminal-icon";

// @aliimam/icons is served by a mandatory global manual mock (__mocks__/@aliimam/icons.js);
// the real package is ESM-only with a broken CJS main and cannot be resolved by jest, and the
// mock renders path-less svgs so glyph geometry can't be compared. The mock instead stamps each
// icon with data-testid="icon-<ExportName>", so we assert component identity: the shared
// TerminalIcon primitive must render Code1Filled, not the accidentally-swept-in CommandSquareFilled.
const glyph = (ui: React.ReactElement) =>
  render(ui).container.querySelector("svg")?.getAttribute("data-testid");

it("nav TerminalIcon renders the Code1Filled glyph, not CommandSquareFilled", () => {
  expect(glyph(<TerminalIcon />)).toBe("icon-Code1Filled");
  expect(glyph(<TerminalIcon />)).not.toBe("icon-CommandSquareFilled");
});
