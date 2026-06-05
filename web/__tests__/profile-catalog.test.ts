/**
 * @jest-environment node
 */

import { buildProfileCatalog } from "@/lib/agents/profile-catalog";

const mockListProfiles = jest.fn();
jest.mock("@/lib/agents/agent-profile-storage", () => ({
  listProfiles: (...args: unknown[]) => mockListProfiles(...args),
}));

const makeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: "claude-sonnet",
  name: "Claude / Sonnet",
  cli: "claude",
  isDefault: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("buildProfileCatalog", () => {
  beforeEach(() => {
    mockListProfiles.mockReset();
  });

  it("returns empty string when no profiles exist", () => {
    mockListProfiles.mockReturnValue([]);
    expect(buildProfileCatalog("ns", "org")).toBe("");
  });

  it("lists profile ids with cli and model", () => {
    mockListProfiles.mockReturnValue([
      makeProfile({ id: "claude-sonnet", name: "Claude / Sonnet", cli: "claude", model: "claude-sonnet-4-6" }),
      makeProfile({ id: "codex-default", name: "Codex / Default", cli: "codex" }),
    ]);

    const result = buildProfileCatalog("ns", "org");

    expect(result).toContain('id: "claude-sonnet"');
    expect(result).toContain('name: "Claude / Sonnet"');
    expect(result).toContain('cli: "claude"');
    expect(result).toContain('model: "claude-sonnet-4-6"');
    expect(result).toContain('id: "codex-default"');
    expect(result).toContain('name: "Codex / Default"');
    expect(result).toContain('cli: "codex"');
    expect(result).toContain("Do NOT invent profile IDs");
  });

  it("marks default profile", () => {
    mockListProfiles.mockReturnValue([
      makeProfile({ id: "claude-sonnet", isDefault: true }),
    ]);

    const result = buildProfileCatalog("ns", "org");

    expect(result).toContain("(DEFAULT)");
  });

  it("omits model when not set", () => {
    mockListProfiles.mockReturnValue([
      makeProfile({ id: "kollab", cli: "kollab" }),
    ]);

    const result = buildProfileCatalog("ns", "org");

    expect(result).not.toContain("model:");
  });

  it("passes namespace and org to listProfiles", () => {
    mockListProfiles.mockReturnValue([]);
    buildProfileCatalog("myns", "myorg");
    expect(mockListProfiles).toHaveBeenCalledWith("myns", "myorg");
  });
});
