#!/usr/bin/env node
/**
 * Typed system-log boundary for shell invocation surfaces.
 *
 * Replaces the jq payload construction in run-lib.sh's _sys_log. Shell forwards
 * primitive arguments only; this CLI owns validation, payload construction, and
 * HTTP dispatch to /api/system/logs.
 *
 * Logging is best-effort by contract: chain-runner.sh calls _sys_log from its
 * ERR trap, so a failure to log must never mask the failure being reported.
 * Every path here exits 0, and a rejected submission reports on stderr only.
 *
 * usage:
 *   node lib/runner-system-log.js --level info --source chain-runner \
 *     --message "run created" [--detail "run: r-1"]
 */

import { normalizeSystemLogSubmission } from "@/lib/system/system-logger";

interface ParsedArguments {
  level: string;
  source: string;
  message: string;
  detail: string;
}

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = { level: "", source: "", message: "", detail: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1] ?? "";
    switch (argv[index]) {
      case "--level": parsed.level = value; index += 1; break;
      case "--source": parsed.source = value; index += 1; break;
      case "--message": parsed.message = value; index += 1; break;
      case "--detail": parsed.detail = value; index += 1; break;
      default: break;
    }
  }
  return parsed;
}

export function resolveSystemLogEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.WEB_PORT || env.PORT || "3000";
  return `${env.MENTIKO_WEB_URL || `http://localhost:${port}`}/api/system/logs`;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const normalized = normalizeSystemLogSubmission(args);
  if (!normalized.ok) {
    process.stderr.write(`system-log: ${normalized.error}\n`);
    return;
  }

  try {
    await fetch(resolveSystemLogEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`,
        "x-namespace-id": process.env.NAMESPACE_ID || "default",
        "x-org-id": process.env.ORG_ID || "default",
      },
      body: JSON.stringify(normalized.submission),
    });
  } catch {
    // best-effort: the caller is often already reporting a crash.
  }
}

if (require.main === module) {
  void main();
}
