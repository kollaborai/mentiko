#!/bin/bash
# session-log-resolver.sh - invocation-only boundary for typed transcript paths
#
# The TypeScript contract validates profile input, resolves configured transcript
# roots, maps PTY capture UUIDs to JSONL files, and selects timestamp-window
# candidates. Shell retains these historical function names solely for callers
# that still source this file; it must not parse or resolve transcript data.

_SLR_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_session_log_resolver_cli() {
    local code_root="${MENTIKO_CODE_ROOT:-$(cd "$_SLR_SCRIPT_DIR/.." && pwd)}"
    local cli="$code_root/lib/runner-session-log-resolver.js"
    [[ -f "$cli" ]] || {
        echo "runner-session-log-resolver runtime is unavailable: $cli" >&2
        return 1
    }
    node "$cli" "$@"
}

encode_cwd_slug() {
    _session_log_resolver_cli encode-cwd-slug --cli "$1" --cwd "$2"
}

resolve_log_dir() {
    _session_log_resolver_cli log-dir --profile-or-cli "$1" --cwd "$2"
}

resolve_session_log() {
    _session_log_resolver_cli session-log --log-dir "$1" --session "$2" --pty-binary "$3"
}

find_conversation_files() {
    local cli="${3:-claude}"
    _session_log_resolver_cli conversation-files --log-dir "$1" --started-at "$2" --cli "$cli"
}
