#!/usr/bin/env node

import { config } from "@/lib/config";
import { ensurePtyDaemon, pty, type SessionInfo } from "@/lib/pty/pty-client";

export interface PtyTransportClient {
  ensure(): Promise<void>;
  alive(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  list(): Promise<SessionInfo[]>;
  pid(name: string): Promise<number | null>;
}

const liveClient: PtyTransportClient = {
  ensure: ensurePtyDaemon,
  alive: (name) => pty.alive(name),
  has: (name) => pty.has(name),
  list: () => pty.list(),
  pid: (name) => pty.pid(name),
};

export async function runPtyTransportCli(
  argv: string[],
  write: (line: string) => void = console.log,
  client: PtyTransportClient = liveClient,
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "daemon-name") {
    requireNoArgs(rest, command);
    write(config.ptyDaemonName);
    return 0;
  }
  if (command === "ensure") {
    requireNoArgs(rest, command);
    await client.ensure();
    write("ready");
    return 0;
  }

  if (command === "list") {
    requireNoArgs(rest, command);
    for (const session of await client.list()) write(session.name);
    return 0;
  }

  const name = parseName(rest, command);
  if (command === "alive") {
    const alive = await client.alive(name);
    write(alive ? "alive" : "dead");
    return alive ? 0 : 1;
  }
  if (command === "has") {
    const exists = await client.has(name);
    write(exists ? "exists" : "missing");
    return exists ? 0 : 1;
  }
  if (command === "pid") {
    const pid = await client.pid(name);
    if (pid === null) {
      write("missing");
      return 1;
    }
    write(String(pid));
    return 0;
  }
  throw new Error("usage: runner-pty-transport <daemon-name|ensure|alive|has|list|pid> [--name <session>]");
}

function requireNoArgs(argv: string[], command: string): void {
  if (argv.length !== 0) throw new Error(`${command} does not accept arguments`);
}

function parseName(argv: string[], command: string | undefined): string {
  if (argv.length !== 2 || argv[0] !== "--name" || !argv[1]?.trim()) {
    throw new Error(`${command} requires --name <session>`);
  }
  return argv[1];
}

if (typeof require !== "undefined" && require.main === module) {
  runPtyTransportCli(process.argv.slice(2))
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(`runner pty transport failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
