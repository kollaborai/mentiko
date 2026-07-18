#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { readFileSync } from "node:fs";
import { runPeerLinkController, type PeerLinkControllerContext } from "@/lib/links/peer-link-controller";

async function main(): Promise<void> {
  const [flag, contextPath] = process.argv.slice(2);
  if (flag !== "--context" || !contextPath) throw new Error("usage: runner-peer-link-controller --context <path>");
  await runPeerLinkController(JSON.parse(readFileSync(contextPath, "utf8")) as PeerLinkControllerContext);
}

main().catch((error) => {
  console.error(`typed peer link controller failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
