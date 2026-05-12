import {
  buildLinkRunEnv,
  buildShellSetup,
  normalizeLinkId,
  normalizePeerSessionId,
  resolvePeerOutputDir,
  resolvePeerReplyPath,
  resolveLinkRunSecret,
  resolveLinkRunsDir,
  validateLinkRunId,
} from "../link-run-runtime";
import { resolveAppSecret } from "../dev-secret";

jest.mock("../config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/data",
    codeRoot: "/opt/mentiko",
    runsDir: "/custom/current/runs",
    namespaceId: "current-ns",
    orgId: "current-org",
  },
  nsPath: (namespaceId: string, ...segments: string[]) =>
    ["/data/namespaces", namespaceId, ...segments].join("/"),
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) =>
    orgId === "default"
      ? ["/data/namespaces", namespaceId, ...segments].join("/")
      : ["/data/namespaces", namespaceId, "orgs", orgId, ...segments].join("/"),
}));

jest.mock("../dev-secret", () => ({
  resolveAppSecret: jest.fn(() => "runtime-secret"),
}));

describe("link-run-runtime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the configured runs dir for the current runtime namespace", () => {
    expect(resolveLinkRunsDir("current-ns", "current-org")).toBe("/custom/current/runs");
  });

  it("uses request-scoped org runs for a different tenant context", () => {
    expect(resolveLinkRunsDir("acme", "engineering")).toBe(
      "/data/namespaces/acme/orgs/engineering/runs"
    );
  });

  it("builds the child environment from request scoped roots", () => {
    expect(
      buildLinkRunEnv({
        namespaceId: "acme",
        orgId: "engineering",
        runId: "run-123",
        runsDir: "/data/namespaces/acme/orgs/engineering/runs",
        workspacePath: "/workspaces/repo",
        authSecret: "secret-value",
      })
    ).toEqual({
      BETTER_AUTH_SECRET: "secret-value",
      LINK_RUN_ID: "run-123",
      MENTIKO_CODE_ROOT: "/opt/mentiko",
      MENTIKO_GLOBAL_ROOT: "/data",
      MENTIKO_NAMESPACE_ROOT: "/data/namespaces/acme",
      MENTIKO_ORG_ROOT: "/data/namespaces/acme/orgs/engineering",
      MENTIKO_PROJECT_ROOT: "/data/namespaces/acme/orgs/engineering",
      NAMESPACE_ID: "acme",
      ORG_ID: "engineering",
      PEER_WORK_DIR: "/workspaces/repo",
      RUNS_DIR: "/data/namespaces/acme/orgs/engineering/runs",
    });
  });

  it("quotes child shell setup without expanding path characters", () => {
    const setup = buildShellSetup(
      {
        LINK_RUN_ID: "run-123",
        PEER_WORK_DIR: "/tmp/repo with 'quote'",
        RUNS_DIR: "/tmp/runs",
      },
      "/tmp/repo with 'quote'"
    );

    expect(setup).toContain("unset CLAUDECODE");
    expect(setup).toContain("export PEER_WORK_DIR='/tmp/repo with '\\''quote'\\'''");
    expect(setup).toContain("cd '/tmp/repo with '\\''quote'\\'''");
  });

  it("resolves the runtime secret from env-backed secret resolution, not web/.env.local", () => {
    expect(resolveLinkRunSecret()).toBe("runtime-secret");
    expect(resolveAppSecret).toHaveBeenCalledWith("link-run");
  });

  it("rejects traversal link ids and malformed run ids", () => {
    expect(normalizeLinkId("../secret")).toBeNull();
    expect(normalizeLinkId("code-review.v1")).toBe("code-review.v1");

    expect(validateLinkRunId("run-123")).toBe(true);
    expect(validateLinkRunId("../run-123")).toBe(false);
    expect(validateLinkRunId("run-123/../../x")).toBe(false);
  });

  it("resolves live peer-manager reply paths under the request namespace", () => {
    expect(normalizePeerSessionId("link-mh1z")).toBe("link-mh1z");
    expect(normalizePeerSessionId("../link-mh1z")).toBeNull();
    expect(resolvePeerOutputDir("acme")).toBe("/data/namespaces/acme/peer-output");
    expect(resolvePeerReplyPath("acme", "link-mh1z")).toBe(
      "/data/namespaces/acme/peer-escalations/link-mh1z/reply.txt"
    );
  });
});
