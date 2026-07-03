import { resolvePtyMgrPath } from "./pty-client";

describe("resolvePtyMgrPath", () => {
  const codeRoot = "/repo/mentiko";

  function resolver(paths: string[]) {
    const existing = new Set(paths);
    return (path: string) => existing.has(path);
  }

  it("prefers explicit pty manager overrides before bundled fallbacks", () => {
    const resolved = resolvePtyMgrPath({
      codeRoot,
      env: {
        MENTIKO_PTY_MGR_BIN: "/custom/pty-mgr",
      },
      exists: resolver([
        "/custom/pty-mgr",
        "/repo/mentiko/lib/pty-manager.mjs",
      ]),
    });

    expect(resolved).toBe("/custom/pty-mgr");
  });

  it("prefers the packaged pty-mgr binary before production fallbacks", () => {
    const resolved = resolvePtyMgrPath({
      codeRoot,
      env: {},
      exists: resolver([
        "/repo/mentiko/web/node_modules/.bin/pty-mgr",
        "/usr/local/bin/pty-mgr",
        "/repo/mentiko/bin/pty-mgr",
        "/repo/mentiko/lib/pty-manager.mjs",
      ]),
    });

    expect(resolved).toBe("/repo/mentiko/web/node_modules/.bin/pty-mgr");
  });

  it("uses the runtime packaged pty-mgr binary in standalone builds", () => {
    const resolved = resolvePtyMgrPath({
      codeRoot,
      env: {},
      exists: resolver([
        "/repo/mentiko/node_modules/.bin/pty-mgr",
        "/repo/mentiko/web/node_modules/.bin/pty-mgr",
        "/usr/local/bin/pty-mgr",
      ]),
    });

    expect(resolved).toBe("/repo/mentiko/node_modules/.bin/pty-mgr");
  });

  it("prefers the production pty-mgr binary before the vendored lib", () => {
    const resolved = resolvePtyMgrPath({
      codeRoot,
      env: {},
      exists: resolver([
        "/usr/local/bin/pty-mgr",
        "/repo/mentiko/bin/pty-mgr",
        "/repo/mentiko/lib/pty-manager.mjs",
      ]),
    });

    expect(resolved).toBe("/usr/local/bin/pty-mgr");
  });

  it("uses the repo wrapper before falling back to the vendored lib", () => {
    const resolved = resolvePtyMgrPath({
      codeRoot,
      env: {},
      exists: resolver([
        "/repo/mentiko/bin/pty-mgr",
        "/repo/mentiko/lib/pty-manager.mjs",
      ]),
    });

    expect(resolved).toBe("/repo/mentiko/bin/pty-mgr");
  });

  it("keeps the vendored lib as the final packaged fallback", () => {
    const resolved = resolvePtyMgrPath({
      codeRoot,
      env: {},
      exists: resolver(["/repo/mentiko/lib/pty-manager.mjs"]),
    });

    expect(resolved).toBe("/repo/mentiko/lib/pty-manager.mjs");
  });
});
