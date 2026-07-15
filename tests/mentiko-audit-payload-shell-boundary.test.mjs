// Bounded wave: bin/mentiko must submit audit metadata as repeated --meta
// key=value primitives (accepted by web/lib/system/audit-cli.ts) and must NOT
// build the payload with a jq serializer or the legacy --metadata-json switch.
// This locks the four remaining audit write sites in bin/mentiko:
// cli_command, agent_action send, agent_action kill, event_emit. It deliberately
// mirrors the audit-ship-shell-boundary test: source-grep contract, not runtime.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const target = join(root, "bin", "mentiko");
const source = readFileSync(target, "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/, ""))
  .join("\n");

// No shell-side JSON serialization for audit metadata anywhere in bin/mentiko.
// These four sites were the only jq / --metadata-json users, so whole-file
// absence is the strongest proof and admits no false siblings.
assert.doesNotMatch(source, /\bjq\b/, "bin/mentiko must not serialize audit metadata with jq");
assert.doesNotMatch(source, /--metadata-json/, "bin/mentiko must not submit audit metadata via --metadata-json");

// Each audit write forwards its persisted metadata as --meta primitives with the
// exact keys/values (and the send message truncation) preserved. Substrings are
// literal shell source, so the assertions pin the forwarded primitive shape.
assert.ok(
  source.includes('--meta command="$CMD" --meta args="$*"'),
  "cli_command must forward command + args primitives"
);
assert.ok(
  source.includes('--meta action="send" --meta target="$SESSION" --meta details="message: ${MESSAGE:0:100}"'),
  "agent_action send must forward action/target/details primitives and preserve message truncation"
);
assert.ok(
  source.includes('--meta action="kill" --meta target="$SESSION"'),
  "agent_action kill must forward action/target primitives"
);
assert.ok(
  source.includes('--meta event_name="$EVENT_NAME" --meta source="$SOURCE"'),
  "event_emit must forward event_name/source primitives"
);

// All four writes still land through the typed audit CLI.
assert.equal((source.match(/runner-audit\.js" write/g) || []).length, 4, "exactly four audit write sites expected");

execFileSync("bash", ["-n", target]);

console.log("mentiko audit payload shell boundary: four sites forward --meta primitives, no jq / --metadata-json");
