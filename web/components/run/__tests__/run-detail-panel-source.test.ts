import { readFileSync } from "fs";

describe("run detail terminal interactivity source contract", () => {
  const source = readFileSync(new URL("../run-detail-panel.tsx", import.meta.url), "utf8");

  it("does not hardcode agent terminals to read-only", () => {
    expect(source).toContain("terminalInputEnabled");
    expect(source).toContain("setTerminalInputEnabled");
    expect(source).toContain('readOnly={!terminalInputEnabled}');
    expect(source).not.toContain("readOnly={true}");
  });

  it("offers terminal input only for active or recoverable agent sessions", () => {
    expect(source).toContain("canInteractWithAgentTerminal");
    expect(source).toContain("startup_recovery");
    expect(source).toContain("blocked");
    expect(source).toContain("running");
  });
});
