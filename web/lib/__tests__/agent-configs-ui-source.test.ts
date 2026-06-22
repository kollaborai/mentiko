import { readFileSync } from "node:fs";

describe("agent config settings source contract", () => {
  it("sends an empty env object so deleting all variables clears the profile", () => {
    const source = readFileSync("app/settings/agent-configs/page.tsx", "utf8");

    expect(source).toContain("env: editEnv,");
    expect(source).not.toContain("env: Object.keys(editEnv).length ? editEnv : undefined");
  });
});
