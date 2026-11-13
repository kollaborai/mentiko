import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandResult } from "./dev-environment-checks";
import {
  checkSqliteNativeAddons,
  SQLITE_ADDON_PACKAGES,
  type RunCommand,
} from "./sqlite-native-addons";

const failedLoad: CommandResult = {
  status: 1,
  stdout: "",
  stderr: "NODE_MODULE_VERSION mismatch",
};
const passedLoad: CommandResult = { status: 0, stdout: "", stderr: "" };

describe("checkSqliteNativeAddons", () => {
  it("rebuilds once and verifies the addons again during preflight", () => {
    const run = jest
      .fn<ReturnType<RunCommand>, Parameters<RunCommand>>()
      .mockReturnValueOnce(failedLoad)
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce(passedLoad);
    const onRebuild = jest.fn();

    const result = checkSqliteNativeAddons({
      run,
      executable: "/node",
      nodeVersion: "v24.18.0",
      preflight: true,
      onRebuild,
    });

    expect(result).toMatchObject({ id: "sqlite-addons", status: "pass" });
    expect(run.mock.calls).toEqual([
      ["/node", ["-e", expect.any(String)]],
      ["npm", ["rebuild", ...SQLITE_ADDON_PACKAGES], 300_000],
      ["/node", ["-e", expect.any(String)]],
    ]);
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it("reports a failed addon load without rebuilding outside preflight", () => {
    const run = jest
      .fn<ReturnType<RunCommand>, Parameters<RunCommand>>()
      .mockReturnValue(failedLoad);

    const result = checkSqliteNativeAddons({
      run,
      executable: "/node",
      nodeVersion: "v24.18.0",
      preflight: false,
    });

    expect(result).toMatchObject({
      id: "sqlite-addons",
      status: "fail",
      message: expect.stringContaining("NODE_MODULE_VERSION mismatch"),
      remediation: expect.stringContaining("npm rebuild better-sqlite3"),
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe("/node");
  });

  it("keeps the check failed when rebuilding does not restore addon loading", () => {
    const run = jest
      .fn<ReturnType<RunCommand>, Parameters<RunCommand>>()
      .mockReturnValue(failedLoad);

    const result = checkSqliteNativeAddons({
      run,
      executable: "/node",
      nodeVersion: "v24.18.0",
      preflight: true,
    });

    expect(result.status).toBe("fail");
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[1]).toEqual([
      "npm",
      ["rebuild", ...SQLITE_ADDON_PACKAGES],
      300_000,
    ]);
  });

  it("approves install scripts for both pinned native addon versions", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
    ) as { allowScripts?: Record<string, boolean> };

    expect(manifest.allowScripts).toEqual(
      expect.objectContaining({
        "better-sqlite3@12.6.2": true,
        "better-sqlite3-multiple-ciphers@12.9.0": true,
      }),
    );
  });
});
