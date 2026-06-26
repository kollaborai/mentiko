#!/usr/bin/env bash
# test-trigger-condition-safety.sh — proves the chain-event-watcher trigger condition
# evaluator is injection-safe. The condition string comes from a chain/marketplace
# definition (untrusted), and used to be run as `eval "[[ $condition ]]"` — arbitrary
# shell. safe_trigger_condition() must REJECT anything that could execute commands or
# break out of the [[ ]] test, while still evaluating simple comparisons on $data.
#
# Usage: tests/bash/test-trigger-condition-safety.sh   (needs bash 4+)

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WATCHER="$REPO_ROOT/lib/chain-event-watcher.sh"

# source ONLY the two functions we need (the watcher file has a top-level main loop).
# shellcheck disable=SC1090
source <(sed -n '/^log() {/,/^}/p;/^safe_trigger_condition() {/,/^}/p' "$WATCHER")
WATCHER_LOG=/dev/null   # log() tees here

PASS=0; FAIL=0
PWN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/trigcond.XXXXXX")"
trap 'rm -rf "$PWN_DIR"' EXIT

check() { # <desc> <expected 0|1> <condition> <data>
  local d="$1" exp="$2" cond="$3" data="$4" got
  if safe_trigger_condition "$cond" "$data"; then got=0; else got=1; fi
  if [[ "$got" == "$exp" ]]; then echo "  ok   $d"; PASS=$((PASS+1));
  else echo "  FAIL $d (expected $exp, got $got)"; FAIL=$((FAIL+1)); fi
}

echo "valid conditions still evaluate:"
check "equality match"        0 '"$data" == "deploy"' "deploy"
check "equality no-match"     1 '"$data" == "deploy"' "build"
check "glob contains"         0 '"$data" == *err*'    "fatal error"
check "regex match"           0 '"$data" =~ ^v[0-9]'  "v2.1"
check "empty = always match"  0 ''                    "anything"
check "unary -n"              0 '-n "$data"'          "x"
check "unary -z no-match"     1 '-z "$data"'          "x"

echo "injection attempts are rejected (return 1):"
check "test-bracket breakout" 1 "x ]] || touch $PWN_DIR/p1 || [[ y" "z"
check "command substitution"  1 "\$(touch $PWN_DIR/p2)"             "z"
check "semicolon chaining"    1 "\"\$data\" == x; touch $PWN_DIR/p3" "z"
check "backtick"              1 "\`touch $PWN_DIR/p4\`"             "z"
check "pipe chaining"         1 "\"\$data\" == x | touch $PWN_DIR/p5" "z"
check "background &"          1 "\"\$data\" == x & touch $PWN_DIR/p6" "z"
check "process substitution"  1 "cat <(touch $PWN_DIR/p7)"          "z"

echo "no injected command executed:"
if compgen -G "$PWN_DIR/p*" >/dev/null; then
  echo "  FAIL — injection EXECUTED: $(ls "$PWN_DIR")"; FAIL=$((FAIL+1))
else
  echo "  ok   no files created by rejected conditions"; PASS=$((PASS+1))
fi

echo "----------------------------------------"
echo "trigger-condition-safety: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
