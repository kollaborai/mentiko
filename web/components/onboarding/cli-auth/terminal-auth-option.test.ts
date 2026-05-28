import { getTerminalAuthCommand } from "./terminal-auth-option";

describe("getTerminalAuthCommand", () => {
  it("uses the kollab login command for the kollab cli tool", () => {
    expect(getTerminalAuthCommand("kollab")).toBe("kollab --login openai");
  });

  it("uses the Antigravity launcher instead of the removed Gemini CLI auth command", () => {
    expect(getTerminalAuthCommand("antigravity")).toBe("agy");
    expect(getTerminalAuthCommand("antigravity")).not.toBe("gemini auth login");
  });
});
