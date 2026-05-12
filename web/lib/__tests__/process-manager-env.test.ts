import { readFileSync } from "fs";
import { join } from "path";

describe("process manager environment", () => {
  it("passes pty manager override variables to managed child processes", () => {
    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");

    expect(source).toContain("'PTY_MGR_BIN'");
    expect(source).toContain("'MENTIKO_PTY_MGR_BIN'");
  });

  it("loads the web-local env file when run from the web directory", () => {
    const source = readFileSync(join(process.cwd(), "lib/process-manager.ts"), "utf8");

    expect(source).toContain("path.join(process.cwd(), '.env.local')");
  });
});
