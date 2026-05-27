import { getTerminalAuthCommand } from "./terminal-auth-option";

describe("getTerminalAuthCommand", () => {
  it("uses the kollab login command for the kollab cli tool", () => {
    expect(getTerminalAuthCommand("kollab")).toBe("kollab --login openai");
  });
});
