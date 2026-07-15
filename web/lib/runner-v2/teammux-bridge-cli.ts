#!/usr/bin/env node

import { runTeamMuxBridgeCli } from "@/lib/runner-v2/teammux-bridge";

if (require.main === module) {
  try {
    runTeamMuxBridgeCli(process.argv.slice(2));
  } catch (error) {
    console.error(`team-mux bridge failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
