#!/usr/bin/env node

import { runAuditShipCli } from "@/lib/runner-v2/audit-ship";

if (require.main === module) {
  runAuditShipCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`runner audit-ship failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 0;
    });
}

export { runAuditShipCli };
