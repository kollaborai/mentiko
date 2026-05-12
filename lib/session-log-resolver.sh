#!/bin/bash
# session-log-resolver.sh - resolve session log paths for any CLI
#
# Usage: source session-log-resolver.sh
#   resolve_log_dir <profile_file_or_cli> <cwd>
#   resolve_session_log <log_dir> <session_name> <pty_binary>
#   find_conversation_files <log_dir> <started_at_epoch> [cli]

# -----------------------------------------------------------------------
# default log paths per CLI (fallback when profile has no log_path)
# mirrors provider-bundles.ts
# -----------------------------------------------------------------------
_default_log_path() {
    case "$1" in
        claude|claude-code) echo "$HOME/.claude/projects/" ;;
        codex)              echo "$HOME/.codex/sessions/" ;;
        opencode)           echo "$HOME/.config/opencode/" ;;
        kollab*)            echo "$HOME/.kollab/projects/" ;;
        gemini)             echo "$HOME/.gemini/tmp/" ;;
        *)                  echo "" ;;
    esac
}

# -----------------------------------------------------------------------
# encode cwd into CLI-specific slug
# -----------------------------------------------------------------------
encode_cwd_slug() {
    local cli="$1"
    local cwd="$2"
    case "$cli" in
        claude|claude-code)
            echo "$cwd" | sed 's|^/|-|; s|[/.]|-|g'
            ;;
        kollab*)
            echo "$cwd" | sed 's|^/|-|; s|[/.]|-|g'
            ;;
        codex)
            echo ""
            ;;
        *)
            echo "$cwd" | sed 's|^/|-|; s|[/.]|-|g'
            ;;
    esac
}

# -----------------------------------------------------------------------
# resolve_log_dir: get the directory containing session log files
#   arg 1: profile JSON file path OR bare cli name (e.g. "claude")
#   arg 2: working directory (for cwd slug encoding)
#   returns: absolute path to log directory
# -----------------------------------------------------------------------
resolve_log_dir() {
    local profile_or_cli="$1"
    local cwd="$2"
    local cli="" log_path=""

    if [[ -f "$profile_or_cli" ]]; then
        cli=$(jq -r '.cli // ""' "$profile_or_cli" 2>/dev/null || echo "")
        log_path=$(jq -r '.log_path // ""' "$profile_or_cli" 2>/dev/null || echo "")
    else
        cli="$profile_or_cli"
    fi

    [[ -z "$cli" ]] && cli="claude"

    if [[ -z "$log_path" ]]; then
        log_path=$(_default_log_path "$cli")
    fi

    [[ -z "$log_path" ]] && return 1

    log_path="${log_path/#\~/$HOME}"
    log_path="${log_path%/}"

    local slug
    slug=$(encode_cwd_slug "$cli" "$cwd")
    if [[ -n "$slug" ]]; then
        echo "${log_path}/${slug}"
    else
        echo "$log_path"
    fi
}

# -----------------------------------------------------------------------
# cross-platform file birth time
# -----------------------------------------------------------------------
_file_birth_epoch() {
    stat -f "%B" "$1" 2>/dev/null && return
    local bt
    bt=$(stat -c "%W" "$1" 2>/dev/null || echo 0)
    if [[ "$bt" != "0" && -n "$bt" ]]; then echo "$bt"; return; fi
    stat -c "%Y" "$1" 2>/dev/null || echo 0
}

# -----------------------------------------------------------------------
# resolve_session_log: find a specific session's log file
#   arg 1: log directory (from resolve_log_dir)
#   arg 2: PTY session name
#   arg 3: pty binary path (e.g. bin/p)
#   returns: path to JSONL file, or empty string
# -----------------------------------------------------------------------
resolve_session_log() {
    local log_dir="$1"
    local session="$2"
    local pty_bin="$3"

    [[ ! -d "$log_dir" ]] && { echo ""; return; }

    local capture uuid
    capture=$("$pty_bin" capture "$session" 100 2>/dev/null || echo "")
    uuid=$(echo "$capture" | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}' | head -1)

    if [[ -n "$uuid" ]]; then
        local jsonl="$log_dir/${uuid}.jsonl"
        if [[ -f "$jsonl" ]]; then
            echo "$jsonl"
            return
        fi
    fi

    echo ""
}

# -----------------------------------------------------------------------
# find_conversation_files: find JSONL files created near a timestamp
#   arg 1: log directory
#   arg 2: started_at epoch (seconds)
#   arg 3: cli name (optional, for codex date-dir handling)
#   returns: newline-separated list of matching file paths
# -----------------------------------------------------------------------
find_conversation_files() {
    local log_dir="$1"
    local start_epoch="$2"
    local cli="${3:-claude}"

    [[ ! -d "$log_dir" || "$start_epoch" -le 0 ]] 2>/dev/null && return

    local search_dir="$log_dir"

    if [[ "$cli" == "codex" ]]; then
        local _date_dir
        _date_dir=$(date -r "$start_epoch" "+%Y/%m/%d" 2>/dev/null \
            || date -d "@$start_epoch" "+%Y/%m/%d" 2>/dev/null || echo "")
        [[ -n "$_date_dir" && -d "$log_dir/$_date_dir" ]] && search_dir="$log_dir/$_date_dir"
    fi

    local matched=()
    while IFS= read -r f; do
        local be
        be=$(_file_birth_epoch "$f")
        local diff=$(( be - start_epoch ))
        if [[ "$diff" -ge -30 && "$diff" -le 30 ]]; then
            matched+=("$f")
        fi
    done < <(find "$search_dir" -name "*.jsonl" -maxdepth 2 2>/dev/null)

    if [[ "${#matched[@]}" -gt 0 ]]; then
        printf '%s\n' "${matched[@]}"
        return
    fi

    local newest
    newest=$(find "$search_dir" -name "*.jsonl" -maxdepth 2 2>/dev/null \
        | while read -r f; do echo "$(_file_birth_epoch "$f") $f"; done \
        | sort -rn | head -1 | cut -d' ' -f2-)
    [[ -n "$newest" ]] && echo "$newest"
}
