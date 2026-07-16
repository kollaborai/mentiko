// Typed reader for the agent-profile selection record.
//
// The peer CLIs (bin/peer-manager, bin/peer-chain, bin/peer-swarm) receive a
// profile-selection record from the typed profile client and previously
// re-parsed it with `jq -r '.id/.path/.name'`. Re-parsing typed output in the
// shell is the exact contract-ownership leak this migration removes: the shell
// must not read JSON. This module owns that read and validates the record.
//
// Usage (record supplied on stdin):
//   printf '%s' "$PROFILE_JSON" | node lib/agent-profile-fields.mjs triple
//     -> prints id, path, name on three lines (empty line when absent)
//   printf '%s' "$PROFILE_JSON" | node lib/agent-profile-fields.mjs field path
//     -> prints a single field

import { fileURLToPath } from "node:url";

const FIELDS = new Set(["id", "path", "name"]);

export function readProfileSelection(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("profile selection record must be a JSON object");
  }
  return parsed;
}

export function profileField(record, field) {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

export function runAgentProfileFieldsCli(argv, input) {
  const [command, field] = argv;
  let record;
  try {
    record = readProfileSelection(input);
  } catch {
    // A malformed record yields empty fields so the shell fails closed exactly
    // as `jq -r '// empty'` did, without aborting the caller.
    return { code: 0, stdout: command === "triple" ? "\n\n\n" : "\n" };
  }

  if (command === "triple") {
    const id = profileField(record, "id");
    const path = profileField(record, "path");
    const name = profileField(record, "name");
    return { code: 0, stdout: `${id}\n${path}\n${name}\n` };
  }

  if (command === "field") {
    if (!FIELDS.has(field)) {
      return { code: 2, stdout: "", stderr: `unknown field: ${field ?? ""}` };
    }
    return { code: 0, stdout: `${profileField(record, field)}\n` };
  }

  return { code: 2, stdout: "", stderr: `unknown command: ${command ?? ""}` };
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  readStdin().then((input) => {
    const result = runAgentProfileFieldsCli(process.argv.slice(2), input);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exit(result.code);
  });
}
