import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveRuntimePtyDaemon,
  ensureRuntimePathDirectories,
  formatRuntimePathExports,
  resolveRuntimePaths,
} from "@/lib/runner-v2/runtime-paths";

describe("typed runtime paths", () => {
  it("preserves the sourced-shell root aliases without treating MENTIKO_ROOT as data", () => {
    const paths = resolveRuntimePaths({
      HOME: "/home/marco",
      MENTIKO_CODE_ROOT: "/code/mentiko",
      MENTIKO_ROOT: "/legacy/code-root",
      NAMESPACE_ID: "acme",
      ORG_ID: "engineering",
      MENTIKO_PROJECT_DIR: "/work/app",
    }, { codeRoot: "/fallback" });

    expect(paths.values.MENTIKO_ROOT).toBe("/legacy/code-root");
    expect(paths.values.MENTIKO_GLOBAL_ROOT).toBe("/home/marco/.mentiko");
    expect(paths.values.MENTIKO_PROJECT_ROOT).toBe("/home/marco/.mentiko/namespaces/acme/orgs/engineering/projects/-work-app");
    expect(paths.values.CHAINS_DIR).toBe(paths.values.CHAIN_DIR);
  });

  it("honors environment path overrides and creates only the legacy config directory set", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-runtime-paths-"));
    try {
      const paths = resolveRuntimePaths({
        MENTIKO_CODE_ROOT: "/code/mentiko",
        MENTIKO_GLOBAL_ROOT: root,
        NAMESPACE_ID: "acme",
        ORG_ID: "default",
        RUNS_DIR: join(root, "custom-runs"),
      }, { codeRoot: "/fallback" });
      ensureRuntimePathDirectories(paths);

      expect(paths.values.RUNS_DIR).toBe(join(root, "custom-runs"));
      expect(existsSync(join(root, "namespaces", "acme", "chains"))).toBe(true);
      expect(existsSync(join(root, "custom-runs"))).toBe(true);
      expect(existsSync(paths.values.WORKSPACE_DIR)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits sourceable primitive exports without permitting shell interpolation", () => {
    const value = "one'; touch /tmp/not-run; echo 'two";
    const paths = resolveRuntimePaths({
      MENTIKO_CODE_ROOT: value,
      MENTIKO_GLOBAL_ROOT: "/data",
    }, { codeRoot: "/fallback" });
    const exports = formatRuntimePathExports(paths);

    expect(exports).toContain("export MENTIKO_CODE_ROOT='one'\\''; touch /tmp/not-run; echo '\\''two'");
    expect(deriveRuntimePtyDaemon("/data root", "acme", "engineering")).toBe("mentiko-data-root-acme-engineering");
  });
});
