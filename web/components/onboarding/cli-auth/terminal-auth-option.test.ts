import { getTerminalAuthCommand } from "./terminal-auth-option";

describe("getTerminalAuthCommand", () => {
  it("uses the kollab login command for the kollabor cli tool", () => {
    expect(getTerminalAuthCommand("kollabor")).toBe("kollab --login openai");
  });
});
