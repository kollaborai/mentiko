import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(tmpdir(), `mentiko-agent-profile-storage-${process.pid}`);

function resetRoot() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

describe("agent profile storage", () => {
  beforeEach(() => {
    jest.resetModules();
    resetRoot();
    jest.doMock("@/lib/config", () => ({
      orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => (
        orgId === "default"
          ? join(root, "namespaces", namespaceId, ...segments)
          : join(root, "namespaces", namespaceId, "orgs", orgId, ...segments)
      ),
    }));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("keeps advisor default separate from agent default and unique", async () => {
    const {
      createProfile,
      findAdvisorDefaultProfile,
      getProfile,
      updateProfile,
    } = await import("../agents/agent-profile-storage");

    createProfile("default", "default", {
      id: "agent-default",
      name: "Agent Default",
      isDefault: true,
      isAdvisorDefault: false,
      cli: "kollab",
    });
    createProfile("default", "default", {
      id: "advisor-one",
      name: "Advisor One",
      isDefault: false,
      isAdvisorDefault: true,
      cli: "kollab",
    });
    createProfile("default", "default", {
      id: "advisor-two",
      name: "Advisor Two",
      isDefault: false,
      isAdvisorDefault: false,
      cli: "codex",
    });

    expect(findAdvisorDefaultProfile("default", "default")?.id).toBe("advisor-one");
    expect(getProfile("default", "default", "agent-default")?.isDefault).toBe(true);

    updateProfile("default", "default", "advisor-two", { isAdvisorDefault: true });

    expect(findAdvisorDefaultProfile("default", "default")?.id).toBe("advisor-two");
    expect(getProfile("default", "default", "advisor-one")?.isAdvisorDefault).toBe(false);
    expect(getProfile("default", "default", "agent-default")?.isDefault).toBe(true);

    const advisorTwoFile = join(root, "namespaces", "default", "agent-profiles", "advisor-two.json");
    expect(JSON.parse(readFileSync(advisorTwoFile, "utf8")).isAdvisorDefault).toBe(true);
  });

  test("partial updates do not erase existing profile fields", async () => {
    const {
      createProfile,
      getProfile,
      updateProfile,
    } = await import("../agents/agent-profile-storage");

    createProfile("default", "default", {
      id: "kollab",
      name: "Kollab / Mentiko",
      description: "workspace default",
      isDefault: true,
      isAdvisorDefault: false,
      cli: "kollab",
      model: "example-model",
      pipe_flag: "-p",
    });

    updateProfile("default", "default", "kollab", {
      name: undefined,
      cli: undefined,
      isAdvisorDefault: true,
    });

    const profile = getProfile("default", "default", "kollab");
    expect(profile?.name).toBe("Kollab / Mentiko");
    expect(profile?.cli).toBe("kollab");
    expect(profile?.model).toBe("example-model");
    expect(profile?.pipe_flag).toBe("-p");
    expect(profile?.isAdvisorDefault).toBe(true);
  });

});
