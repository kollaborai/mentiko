#!/bin/bash
# agent-activity-capture.sh - capture agent activity artifacts after completion
#
# Writes to namespaces/{ns}/runs/{runId}/artifacts/:
#   {agentId}-diff.patch           git diff from before SHA → current HEAD
#   {agentId}-files-changed.json   list of changed files with M/A/D status
#   {agentId}-conversations.json   conversation JSONL paths active during run
#   {agentId}-output.txt           terminal session output (copied from report)
#
# Usage: source agent-activity-capture.sh
#   capture-agent-activity <agent_id> <run_id> <project_root> <report_file> [namespace_id] [profile_file]
#
# Prereqs (written by caller before agent starts):
#   artifacts/{agentId}-git-before.txt  (SHA before agent)
#   artifacts/{agentId}-started-at.txt  (ISO timestamp before agent)

# Source config for RUNS_DIR path (used for local workspace)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/session-log-resolver.sh" 2>/dev/null || true
source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true

capture-agent-activity() {
    local agent_id="${1:-}"
    local run_id="${2:-}"
    local project_root="${3:-$(pwd)}"
    local report_file="${4:-}"
    local namespace_id="${5:-${NAMESPACE_ID:-default}}"
    local profile_file="${6:-}"

    [[ -z "$agent_id" || -z "$run_id" ]] && return 0

    # derive artifacts dir from RUNS_DIR (set by config.sh, already namespace-aware)
    local artifacts_dir="${RUNS_DIR:-${MENTIKO_PROJECT_ROOT:-$HOME/.mentiko/namespaces/${namespace_id}}/runs}/${run_id}/artifacts"
    mkdir -p "$artifacts_dir"

    # -----------------------------------------------------------------------
    # 1. git diff → {agentId}-diff.patch + {agentId}-files-changed.json
    # -----------------------------------------------------------------------
    local before_sha_file="$artifacts_dir/${agent_id}-git-before.txt"
    if [[ -f "$before_sha_file" ]]; then
        local before_sha
        before_sha=$(cat "$before_sha_file" | tr -d '[:space:]')

        if [[ -n "$before_sha" ]] && git -C "$project_root" cat-file -e "${before_sha}^{commit}" 2>/dev/null; then
            # generate diff patch
            local diff_file="$artifacts_dir/${agent_id}-diff.patch"
            git -C "$project_root" diff "${before_sha}..HEAD" > "$diff_file" 2>/dev/null || true
            if [[ ! -s "$diff_file" ]]; then
                # try staged/unstaged diff if no commits since before_sha
                git -C "$project_root" diff --staged > "$diff_file" 2>/dev/null || true
                # also capture any unstaged changes
                local unstaged
                unstaged=$(git -C "$project_root" diff 2>/dev/null || true)
                [[ -n "$unstaged" ]] && echo "$unstaged" >> "$diff_file"
            fi
            if [[ -s "$diff_file" ]]; then
                local _diff_lines
                _diff_lines=$(wc -l < "$diff_file")
                echo "  activity: diff captured ($_diff_lines lines)"
                _sys_log "info" "activity-capture" "git diff captured: $agent_id" "run: $run_id, lines: $_diff_lines, before_sha: ${before_sha:0:8}"
            fi

            # generate files changed JSON (use jq for safe encoding)
            local changed_json="$artifacts_dir/${agent_id}-files-changed.json"
            git -C "$project_root" diff --name-status "${before_sha}..HEAD" 2>/dev/null \
                | awk -F'\t' '{print $1"\t"$2}' \
                | jq -Rn '[inputs | split("\t") | select(length==2) | {"status":.[0],"file":.[1]}]' \
                > "$changed_json" 2>/dev/null || echo "[]" > "$changed_json"

            local file_count
            file_count=$(git -C "$project_root" diff --name-only "${before_sha}..HEAD" 2>/dev/null | wc -l || echo 0)
            echo "  activity: ${file_count} files changed"
        fi
    fi

    # -----------------------------------------------------------------------
    # 2. find conversations via session-log-resolver
    # -----------------------------------------------------------------------
    local started_at_file="$artifacts_dir/${agent_id}-started-at.txt"
    local conv_json="$artifacts_dir/${agent_id}-conversations.json"

    if [[ -f "$started_at_file" ]]; then
        local started_at
        started_at=$(cat "$started_at_file" | tr -d '[:space:]')

        local start_no_tz
        start_no_tz=$(echo "$started_at" | sed 's/[-+][0-9][0-9]:[0-9][0-9]$//')
        local start_epoch
        start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$start_no_tz" "+%s" 2>/dev/null \
            || date -d "$started_at" "+%s" 2>/dev/null || echo 0)

        local conv_files=()
        local cli="claude"

        if [[ -n "$profile_file" && -f "$profile_file" ]]; then
            cli=$(jq -r '.cli // "claude"' "$profile_file" 2>/dev/null || echo "claude")
            local log_dir
            log_dir=$(resolve_log_dir "$profile_file" "$project_root")
            if [[ -d "$log_dir" && "$start_epoch" -gt 0 ]]; then
                while IFS= read -r f; do
                    [[ -n "$f" ]] && conv_files+=("$f")
                done < <(find_conversation_files "$log_dir" "$start_epoch" "$cli")
            fi
        else
            local log_dir
            log_dir=$(resolve_log_dir "claude" "$project_root")
            if [[ -d "$log_dir" && "$start_epoch" -gt 0 ]]; then
                while IFS= read -r f; do
                    [[ -n "$f" ]] && conv_files+=("$f")
                done < <(find_conversation_files "$log_dir" "$start_epoch" "claude")
            fi
        fi

        if [[ "${#conv_files[@]}" -gt 0 ]]; then
            printf '[\n' > "$conv_json"
            local first=true
            for cf in "${conv_files[@]}"; do
                $first || printf ',\n' >> "$conv_json"
                first=false
                printf '{"path":"%s"}' "$cf" >> "$conv_json"
            done
            printf '\n]\n' >> "$conv_json"
            echo "  activity: ${#conv_files[@]} conversation(s) captured"
            _sys_log "info" "activity-capture" "conversations captured: $agent_id" "run: $run_id, count: ${#conv_files[@]}"
        else
            echo "[]" > "$conv_json"
            echo "  activity: no conversations found"
            _sys_log "info" "activity-capture" "no conversations found: $agent_id" "run: $run_id"
        fi
    fi

    # -----------------------------------------------------------------------
    # 3. copy terminal output → {agentId}-output.txt
    # -----------------------------------------------------------------------
    if [[ -f "$report_file" ]]; then
        local output_file="$artifacts_dir/${agent_id}-output.txt"
        cp "$report_file" "$output_file" 2>/dev/null || true
        echo "  activity: output stored ($(wc -l < "$output_file") lines)"
    fi

    # -----------------------------------------------------------------------
    # 4. write artifact manifest to run.json (non-critical, best-effort)
    # -----------------------------------------------------------------------
    local run_json="${RUNS_DIR:-${MENTIKO_PROJECT_ROOT:-$HOME/.mentiko/namespaces/${namespace_id}}/runs}/${run_id}/run.json"
    if [[ -f "$run_json" ]] && command -v jq &>/dev/null; then
        local diff_file="$artifacts_dir/${agent_id}-diff.patch"
        local changed_file="$artifacts_dir/${agent_id}-files-changed.json"
        local diff_lines=0 file_count=0
        [[ -f "$diff_file" ]] && diff_lines=$(wc -l < "$diff_file" 2>/dev/null || echo 0)
        [[ -f "$changed_file" ]] && file_count=$(jq 'length' "$changed_file" 2>/dev/null || echo 0)

        # write jq filter to temp file (avoids shell quoting issues with != operator)
        local jq_filter tmp
        jq_filter=$(mktemp)
        tmp=$(mktemp)
        cat > "$jq_filter" << 'JQ_EOF'
def upsert(obj):
  .artifacts = ((.artifacts // [])
    | map(select(.agentId != $aid or .type != obj.type))
    + [obj]);
. | upsert({"agentId":$aid,"type":"diff","diffLines":$dl,"timestamp":$ts})
  | upsert({"agentId":$aid,"type":"conversations","timestamp":$ts})
  | upsert({"agentId":$aid,"type":"output","timestamp":$ts})
  | if $fc > 0 then upsert({"agentId":$aid,"type":"files","fileCount":$fc,"timestamp":$ts}) else . end
JQ_EOF
        jq --arg aid "$agent_id" \
           --arg ts "$(date -Iseconds)" \
           --argjson dl "${diff_lines:-0}" \
           --argjson fc "${file_count:-0}" \
           -f "$jq_filter" \
           "$run_json" > "$tmp" 2>/dev/null \
           && mv "$tmp" "$run_json" 2>/dev/null || rm -f "$tmp"
        rm -f "$jq_filter"
    fi
}
