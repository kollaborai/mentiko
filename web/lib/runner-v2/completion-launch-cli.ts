#!/usr/bin/env node
// Anchor before importing the launcher, which loads config and the PTY client.
import "@/lib/runner-v2/entry-code-root-anchor";
import { launchRunnerV2CompletionPty } from "@/lib/runner-v2/completion-launch";

async function main(): Promise<void> {
  const sessionName = process.argv[2];
  const chainPath = process.argv[3];
  if (!sessionName || !chainPath) {
    console.error("usage: runner-v2-completion-launch <session-name> <chain.json>");
    process.exitCode = 64;
    return;
  }

  const launched = await launchRunnerV2CompletionPty({ sessionName, chainPath });
  console.log(JSON.stringify({ status: "started", session: launched.name, pid: launched.pid }));
}

main().catch((error) => {
  console.error(`runner-v2 completion launch failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
