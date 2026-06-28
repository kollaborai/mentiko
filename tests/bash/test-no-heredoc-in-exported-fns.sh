#!/bin/bash
# test-no-heredoc-in-exported-fns.sh
#
# Guard against the chain-completion crash class: an `export -f`'d bash function
# whose body does not survive serialization, so every CHILD shell that inherits
# it aborts at startup with
#   bash: <fn>: line N: syntax error near unexpected token `||'
#   bash: error importing function definition for `<fn>'
#
# Real-world trigger (commit 23bdfe7): lib/performance.sh _perf_ensure_file used
#   cat > "$f" 2>/dev/null <<'EOF' ... EOF || true
# The heredoc redirect with a trailing `|| true` does not round-trip through
# `export -f`, so every subshell the engine spawned (chain-event-watcher,
# agents, pty bridges, watchdog, monitors) errored on startup.
#
# THE INVARIANT this test enforces: for every lib file that exports functions,
# sourcing it and spawning a child shell must NOT produce an import error. This
# is the exact failure mode and has zero false positives — a plain heredoc that
# happens to serialize fine on this bash is allowed (but flagged as a fragile
# smell in the informational section, since it can break on other bash versions).
#
# Fix pattern when this fails: replace the heredoc with printf / jq -n / echo.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PROJECT_ROOT/lib"

TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo "  [PASS] $1"; ((TESTS_PASSED++)) || true; }
fail() { echo "  [FAIL] $1"; ((TESTS_FAILED++)) || true; }

# -------------------------------------------------------------------
# helper: scan one .sh file for heredocs inside exported function bodies.
# Prints each as "<file>: <fn_name>". Used for the INFORMATIONAL smell list
# only — not a pass/fail criterion (plain heredocs may serialize fine).
# -------------------------------------------------------------------
scan_file_for_heredoc_in_exported_fn() {
    local sh_file="$1"
    [[ -f "$sh_file" ]] || return 0
    grep -qE '^export -f ' "$sh_file" 2>/dev/null || return 0
    local fn_names
    fn_names=$(grep -E '^export -f [A-Za-z_]' "$sh_file" 2>/dev/null | awk '{print $3}' || true)
    [[ -z "$fn_names" ]] && return 0
    while IFS= read -r fn_name; do
        [[ -z "$fn_name" ]] && continue
        local found
        found=$(awk -v fn="$fn_name" '
            $0 ~ ("^" fn "[[:space:]]*\\(\\)") { in_fn=1; depth=0; seen_open=0 }
            in_fn {
                n = split($0, ch, "")
                for (i = 1; i <= n; i++) {
                    if (ch[i] == "{") { depth++; seen_open = 1 }
                    if (ch[i] == "}") depth--
                }
                if ($0 ~ /<<[^<]/) found = 1
                if (seen_open && depth <= 0) { in_fn = 0; seen_open = 0 }
            }
            END { print (found+0 > 0 ? "yes" : "no") }
        ' "$sh_file" 2>/dev/null)
        [[ "$found" == "yes" ]] && printf '%s: %s\n' "$(basename "$sh_file")" "$fn_name"
    done <<< "$fn_names"
}

# -------------------------------------------------------------------
# Per lib file: (1) bash -n syntax, (2) THE GUARD — exported functions must
# import cleanly into a child shell (no "error importing function definition").
# -------------------------------------------------------------------
shopt -s nullglob
HEREDOC_NOTES=()
for _f in "$LIB_DIR"/*.sh; do
    _base="$(basename "$_f")"

    if bash -n "$_f" 2>/dev/null; then
        pass "bash -n $_base"
    else
        fail "bash -n $_base"
        bash -n "$_f" || true
    fi

    if grep -qE '^export -f ' "$_f" 2>/dev/null; then
        # Source the file (its own `export -f` lines run), then exec a child
        # shell. The child re-imports the exported functions from the env at
        # startup — that is where a non-serializable body errors.
        _imperr=$(bash -c "source '$_f' >/dev/null 2>&1; exec bash -c 'true'" 2>&1 1>/dev/null \
            | grep "error importing function definition" || true)
        if [[ -z "$_imperr" ]]; then
            pass "exported fns import clean: $_base"
        else
            fail "exported fns import clean: $_base"
            echo "$_imperr" | sed 's/^/    /'
        fi
    fi

    _hd=$(scan_file_for_heredoc_in_exported_fn "$_f")
    [[ -n "$_hd" ]] && while IFS= read -r _line; do HEREDOC_NOTES+=("$_line"); done <<< "$_hd"
done

# -------------------------------------------------------------------
# Informational: heredocs in exported functions that currently serialize fine
# but are fragile (can break on a different bash version). Not a failure.
# -------------------------------------------------------------------
if [[ "${#HEREDOC_NOTES[@]}" -gt 0 ]]; then
    echo ""
    echo "  NOTE: heredocs in exported functions (import-clean on this bash, but fragile —"
    echo "        prefer printf/jq -n; convert if they ever break a child shell):"
    for _n in "${HEREDOC_NOTES[@]}"; do echo "    (smell) $_n"; done
fi

echo ""
echo "  results: $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ "$TESTS_FAILED" -eq 0 ]]
