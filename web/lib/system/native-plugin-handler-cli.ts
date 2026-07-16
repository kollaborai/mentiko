#!/usr/bin/env node

const HANDLERS = new Set(["pagerduty", "github-pr", "linear", "custom-webhook", "email-digest", "notify-email"]);

/**
 * Typed built-in plugin boundary. Provider implementations land behind this
 * command one at a time; unknown or not-yet-migrated handlers fail closed.
 */
export function runNativePluginHandlerCli(argv: string[]): void {
  if (argv[0] !== "dispatch" || argv[1] !== "--handler" || argv.length !== 3 || !HANDLERS.has(argv[2])) {
    throw new Error("usage: runner-native-plugin dispatch --handler <builtin-handler>");
  }
  throw new Error(`native plugin handler is not implemented: ${argv[2]}`);
}

if (require.main === module) {
  try { runNativePluginHandlerCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
