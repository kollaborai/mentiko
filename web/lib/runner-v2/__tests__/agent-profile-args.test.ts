import {
  normalizePermissionFlag,
  resolveProfilePermissionArgs,
  splitProfileArgumentString,
} from "@/lib/runner-v2/agent-profile-args";

/**
 * Existing tenants may still store this legacy two-flag fragment. Claude
 * 2.1.129 accepts the argv but blocks autonomous startup on a consent modal, so
 * every launcher must normalize it to the direct non-interactive flag.
 */
const COMBINED_PERMISSION_FLAG = "--allow-dangerously-skip-permissions --permission-mode bypassPermissions";

describe("agent profile argv contract", () => {
  it("normalizes the legacy two-flag fragment to the direct non-interactive flag", () => {
    expect(resolveProfilePermissionArgs("claude", COMBINED_PERMISSION_FLAG)).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  it("preserves the direct claude permission bypass flag", () => {
    expect(resolveProfilePermissionArgs("claude", "--dangerously-skip-permissions")).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  it("never yields the consent-gated claude flags", () => {
    for (const flag of [COMBINED_PERMISSION_FLAG, "--dangerously-skip-permissions"]) {
      const args = resolveProfilePermissionArgs("claude", flag);
      expect(args).toEqual(["--dangerously-skip-permissions"]);
      expect(args).not.toContain("--allow-dangerously-skip-permissions");
      expect(args).not.toContain("--permission-mode");
    }
  });

  it("expands the shorthand only for the claude CLI", () => {
    expect(normalizePermissionFlag("codex", "--dangerously-skip-permissions")).toBe("--dangerously-skip-permissions");
    expect(resolveProfilePermissionArgs("codex", "--dangerously-skip-permissions")).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  it("treats an absent permission flag as no argv tokens", () => {
    expect(resolveProfilePermissionArgs("claude", undefined)).toEqual([]);
    expect(resolveProfilePermissionArgs("claude", "")).toEqual([]);
  });

  it("keeps a quoted value as one token and strips the quotes the CLI must not see", () => {
    expect(splitProfileArgumentString('--add-dir "/tmp/path with spaces"', "permission_flag")).toEqual([
      "--add-dir",
      "/tmp/path with spaces",
    ]);
    expect(splitProfileArgumentString('--model="gpt 5"', "extra_args")).toEqual(["--model=gpt 5"]);
  });

  it("honours escaped whitespace instead of splitting on it", () => {
    expect(splitProfileArgumentString("--add-dir /tmp/path\\ with\\ spaces", "permission_flag")).toEqual([
      "--add-dir",
      "/tmp/path with spaces",
    ]);
  });

  it("rejects malformed quotes rather than silently handing a different argv to the CLI", () => {
    expect(() => splitProfileArgumentString('--permission-mode "bypassPermissions', "permission_flag"))
      .toThrow("Invalid permission_flag: unterminated escape or quote");
    expect(() => splitProfileArgumentString("--add-dir 'unterminated", "pipe_flag"))
      .toThrow("Invalid pipe_flag: unterminated escape or quote");
    expect(() => splitProfileArgumentString("--flag value\\", "extra_args"))
      .toThrow("Invalid extra_args: unterminated escape or quote");
  });

  it("rejects a malformed permission fragment through the resolver too", () => {
    expect(() => resolveProfilePermissionArgs("claude", '--permission-mode "bypass'))
      .toThrow("Invalid permission_flag");
  });
});
