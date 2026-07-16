import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "lib", "session-transport.sh"), "utf8");

test("session transport delegates daemon identity, liveness, listing, and PID to the typed boundary", () => {
  assert.match(source, /runner-pty-transport\.js/);
  assert.doesNotMatch(source, /_transport_derive_pty_daemon|_transport_slug_part/);
  for (const pattern of [/\bwhile\b/, /\bsleep\b/, /\bawk\b/, /\bgrep\b/, /\bsed\b/, /\bcut\b/, /\$PTY_CMD"?\s+(?:status|alive|list|pid)/]) {
    assert.doesNotMatch(source, pattern, `shell transport must not own typed PTY behavior: ${pattern}`);
  }
});

test("session transport forwards only primitive typed PTY operations", () => {
  const probe = `
    source ${JSON.stringify(join(root, "lib", "session-transport.sh"))}
    calls=$(mktemp)
    _transport_typed(){
      printf 'call=%s\\n' "$*" >> "$calls"
      case "$1" in
        ensure) printf 'ready\\n' ;;
        alive) printf 'alive\\n' ;;
        has) printf 'exists\\n' ;;
        list) printf 'writer\\nreviewer\\n' ;;
        pid) printf '4242\\n' ;;
        *) return 1 ;;
      esac
    }
    transport_init
    transport_has_session writer
    transport_session_exists reviewer
    transport_list_sessions
    transport_pid writer
    cat "$calls"
    rm -f "$calls"
  `;
  const output = execFileSync("bash", ["-lc", probe], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  expectCalls(output, [
    "call=ensure",
    "call=alive --name writer",
    "call=has --name reviewer",
    "call=list",
    "call=pid --name writer",
  ]);
  assert.match(output, /writer\nreviewer\n4242/);
});

function expectCalls(output, expected) {
  assert.deepEqual(output.match(/^call=.*$/gm), expected);
}
