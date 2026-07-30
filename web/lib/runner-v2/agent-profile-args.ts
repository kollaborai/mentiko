/**
 * Canonical agent-profile argv parsing.
 *
 * `pipe_flag` and `permission_flag` are argv fragments, not single CLI
 * arguments. Every launcher parses them here so one profile cannot mean two
 * different argv vectors depending on which launcher read it: the shell
 * command compiler (agent-profile.ts) renders these tokens quoted, and the
 * detached job worker passes them straight to spawn().
 *
 * Kept dependency-free on purpose — the job worker is bundled standalone by
 * esbuild, so this module must not reach into config, storage, or secrets.
 */

/**
 * Claude Code accepts `--dangerously-skip-permissions` as the explicit
 * non-interactive bypass. Older Mentiko profiles stored the two-flag
 * `--allow-dangerously-skip-permissions --permission-mode bypassPermissions`
 * form, which Claude 2.1.129 gates behind a first-run consent screen. Normalize
 * both forms to the direct flag so autonomous PTY launches cannot stop at that
 * modal.
 */
export function normalizePermissionFlag(cli: string, permissionFlag: string | undefined): string | undefined {
  if (
    cli === "claude"
    && (
      permissionFlag === "--dangerously-skip-permissions"
      || permissionFlag === "--allow-dangerously-skip-permissions --permission-mode bypassPermissions"
    )
  ) {
    return "--dangerously-skip-permissions";
  }
  return permissionFlag;
}

/** Resolve a profile's `permission_flag` into individual argv tokens. */
export function resolveProfilePermissionArgs(cli: string, permissionFlag: string | undefined): string[] {
  const normalized = normalizePermissionFlag(cli, permissionFlag);
  return normalized ? splitProfileArgumentString(normalized, "permission_flag") : [];
}

/**
 * Tokenize a profile argv fragment using the small shell-like syntax profiles
 * are authored in. Shell splitting would make the launcher both incorrect and
 * unsafe; retaining the fragment as one token makes multi-flag profiles fail.
 * Malformed input throws rather than silently yielding a different argv.
 */
export function splitProfileArgumentString(value: string, field: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let started = false;

  for (const character of value) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }

  if (escaped || quote) throw new Error(`Invalid ${field}: unterminated escape or quote`);
  if (started) tokens.push(token);
  return tokens;
}
