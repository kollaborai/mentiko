#!/usr/bin/env node

import { runNotificationDispatcherCli } from "@/lib/runner-v2/notification-dispatcher";

if (require.main === module) {
  runNotificationDispatcherCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`runner notification-dispatcher failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 0;
    });
}

export { runNotificationDispatcherCli };
