import {
  checkCommandResult,
  checkNodeVersion,
  getPtyManagerCandidates,
  getPtyManagerInstallScriptPath,
  parseEnvContent,
  renderDoctorReport,
  summarizeChecks,
  upsertEnvContent,
} from "../dev-environment-checks";

describe("dev environment checks", () => {
  it("accepts the current supported Node major version", () => {
    const check = checkNodeVersion("v22.14.0");

    expect(check.status).toBe("pass");
    expect(check.message).toContain("v22.14.0");
  });

  it("fails old Node versions with setup guidance", () => {
    const check = checkNodeVersion("v20.19.0");

    expect(check.status).toBe("fail");
    expect(check.remediation).toContain("Node 22");
  });

  it("reports a missing kollabor engine import as a setup failure", () => {
    const check = checkCommandResult({
      id: "kollabor-engine",
      label: "Kollabor engine package",
      passMessage: "kollabor_engine imports",
      failMessage: "kollabor_engine is not installed",
      remediation: "Run npm run setup",
      result: { status: 1, stdout: "", stderr: "ModuleNotFoundError" },
    });

    expect(check.status).toBe("fail");
    expect(check.message).toContain("not installed");
    expect(check.remediation).toBe("Run npm run setup");
  });

  it("summarizes failures and renders an operator-friendly report", () => {
    const checks = [
      checkNodeVersion("v22.14.0"),
      checkCommandResult({
        id: "kollabor-engine",
        label: "Kollabor engine package",
        passMessage: "kollabor_engine imports",
        failMessage: "kollabor_engine is not installed",
        remediation: "Run npm run setup",
        result: { status: 1, stdout: "", stderr: "ModuleNotFoundError" },
      }),
    ];

    expect(summarizeChecks(checks)).toEqual({ ok: false, failed: 1, warned: 0 });
    expect(renderDoctorReport(checks)).toContain("FAIL Kollabor engine package");
    expect(renderDoctorReport(checks)).toContain("Run npm run setup");
  });

  it("prefers an explicit pty manager override over local checkout discovery", () => {
    const candidates = getPtyManagerCandidates({
      cwd: "/repo/mentiko/web",
      env: {
        MENTIKO_PTY_MGR_BIN: "/custom/pty-mgr",
      },
    });

    expect(candidates[0]).toEqual({
      label: "MENTIKO_PTY_MGR_BIN override",
      path: "/custom/pty-mgr",
      source: "env",
    });
    expect(candidates[1]).toEqual({
      label: "local pty-mgr checkout",
      path: "/repo/pty-mgr/dist/pty-mgr",
      source: "sibling",
    });
  });

  it("discovers the sibling pty-mgr checkout before falling back to the repo wrapper", () => {
    const candidates = getPtyManagerCandidates({
      cwd: "/repo/mentiko/web",
      env: {
        HOME: "/home/dev",
      },
    });

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "/repo/pty-mgr/dist/pty-mgr",
      "/home/dev/.pty-mgr/bin/pty-mgr",
      "/repo/mentiko/bin/pty-mgr",
    ]);
  });

  it("deduplicates pty manager candidate paths", () => {
    const candidates = getPtyManagerCandidates({
      cwd: "/repo/mentiko/web",
      env: {
        MENTIKO_PTY_MGR_BIN: "/repo/pty-mgr/dist/pty-mgr",
      },
    });

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "/repo/pty-mgr/dist/pty-mgr",
      "/repo/mentiko/bin/pty-mgr",
    ]);
  });

  it("resolves the sibling pty-mgr install script", () => {
    expect(
      getPtyManagerInstallScriptPath({
        cwd: "/repo/mentiko/web",
      }),
    ).toBe("/repo/pty-mgr/install.sh");
  });

  it("parses simple env files without comments", () => {
    expect(
      parseEnvContent(`
# ignored
BETTER_AUTH_SECRET=dev-secret
MENTIKO_PTY_MGR_BIN="/repo/pty-mgr/dist/pty-mgr"
`),
    ).toEqual({
      BETTER_AUTH_SECRET: "dev-secret",
      MENTIKO_PTY_MGR_BIN: "/repo/pty-mgr/dist/pty-mgr",
    });
  });

  it("upserts env values without duplicating existing keys", () => {
    const result = upsertEnvContent(
      "BETTER_AUTH_SECRET=dev-secret\nMENTIKO_PTY_MGR_BIN=/old/path\n",
      {
        MENTIKO_PTY_MGR_BIN: "/new/path",
      },
    );

    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      "BETTER_AUTH_SECRET=dev-secret\nMENTIKO_PTY_MGR_BIN=/new/path\n",
    );
  });

  it("appends missing env values under a local development header", () => {
    const result = upsertEnvContent("", {
      BETTER_AUTH_SECRET: "dev-secret",
    });

    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      "# Local Mentiko development defaults\nBETTER_AUTH_SECRET=dev-secret\n",
    );
  });
});
