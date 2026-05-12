/**
 * @jest-environment node
 */

jest.mock("@/lib/config", () => {
  const globalRoot = "/tmp/mentiko-global";
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

  return {
    __esModule: true,
    default: {
      globalRoot,
      codeRoot: "/repo/mentiko",
      namespaceRoot: join(globalRoot, "namespaces", "default"),
      orgRoot: join(globalRoot, "namespaces", "default"),
      projectRoot: join(globalRoot, "namespaces", "default"),
    },
    nsPath: (nsId: string, ...segments: string[]) =>
      join(globalRoot, "namespaces", nsId, ...segments),
    orgPath: (nsId: string, orgId: string, ...segments: string[]) =>
      orgId === "default"
        ? join(globalRoot, "namespaces", nsId, ...segments)
        : join(globalRoot, "namespaces", nsId, "orgs", orgId, ...segments),
  };
});

import { resolveJobRunnerRoots, resolveJobWorkspaceCwd } from "./job-runner-launch";

describe("job-runner-launch", () => {
  it("resolves runner roots from the request namespace/org instead of static config", () => {
    expect(resolveJobRunnerRoots("mike", "default")).toEqual({
      namespaceRoot: "/tmp/mentiko-global/namespaces/mike",
      orgRoot: "/tmp/mentiko-global/namespaces/mike",
      projectRoot: "/tmp/mentiko-global/namespaces/mike",
    });

    expect(resolveJobRunnerRoots("mike", "engineering")).toEqual({
      namespaceRoot: "/tmp/mentiko-global/namespaces/mike",
      orgRoot: "/tmp/mentiko-global/namespaces/mike/orgs/engineering",
      projectRoot: "/tmp/mentiko-global/namespaces/mike",
    });
  });

  it("keeps the workspace cwd preference order stable", () => {
    expect(
      resolveJobWorkspaceCwd({
        workspace: "/workspace/fallback",
        workspaceId: "/workspace/id",
        workspacePath: "/workspace/path",
        workspaceCwd: "/workspace/cwd",
      }),
    ).toBe("/workspace/cwd");
  });
});
