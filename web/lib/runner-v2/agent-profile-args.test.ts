import {
  normalizePermissionFlag,
  resolveProfilePermissionArgs,
  splitProfileArgumentString,
} from "@/lib/runner-v2/agent-profile-args";

/**
 * The combined permission fragment below is what the shipped claude profiles
 * actually store. Passing it to the CLI as a single argv token produced
 * "error: unknown option '--allow-dangerously-skip-permissions --permission-mode
 * bypassPermissions'" and failed the agent at startup. Every launcher resolves
 * permission flags through this module so that cannot recur in one launcher
 * while the other stays correct.
 */
const COMBINED_PERMISSION_FLAG = "--allow-dangerously-skip-permissions --permission-mode bypassPermissions";

describe("agent profile argv contract", () => {
  it("splits an already-combined permission fragment into separate argv tokens", () => {
    expect(resolveProfilePermissionArgs("claude", COMBINED_PERMISSION_FLAG)).toEqual([
      "--allow-dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
    ]);
  });

  it("expands the claude shorthand into the same separate argv tokens", () => {
    expect(resolveProfilePermissionArgs("claude", "--dangerously-skip-permissions")).toEqual([
      "--allow-dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
    ]);
  });

  it("never yields a token containing the whole combined fragment", () => {
    for (const flag of [COMBINED_PERMISSION_FLAG, "--dangerously-skip-permissions"]) {
      for (const token of resolveProfilePermissionArgs("claude", flag)) {
        expect(token).not.toContain(" ");
      }
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
