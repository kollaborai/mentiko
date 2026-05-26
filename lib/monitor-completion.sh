#!/bin/bash
# monitor-completion.sh - helpers for safe monitor completion detection

MONITOR_COMPLETION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$MONITOR_COMPLETION_DIR/terminal-sanitize.sh"
source "$MONITOR_COMPLETION_DIR/agent-profile.sh" 2>/dev/null || true

monitor_agent_id_for_session() {
    local session_name="$1"
    local chain_file="$2"

    if [[ -n "${MENTIKO_AGENT_ID:-}" ]]; then
        echo "$MENTIKO_AGENT_ID"
        return 0
    fi

    [[ -f "$chain_file" ]] || return 0

    local agent_id=""
    while IFS= read -r agent_id; do
        [[ -n "$agent_id" && "$agent_id" != "null" ]] || continue
        if [[ "$session_name" == *"$agent_id"* ]]; then
            echo "$agent_id"
            return 0
        fi
    done < <(jq -r '.agents[]?.id // empty' "$chain_file" 2>/dev/null)
}

monitor_completion_event_file() {
    local session_name="$1"
    local chain_file="$2"
    local events_dir="$3"
    local agent_id="${4:-}"

    [[ -d "$events_dir" && -f "$chain_file" ]] || return 0

    if [[ -z "$agent_id" ]]; then
        agent_id="$(monitor_agent_id_for_session "$session_name" "$chain_file")"
    fi
    [[ -n "$agent_id" ]] || return 0

    local expected_event
    expected_event="$(jq -r --arg id "$agent_id" '.agents[]? | select(.id == $id) | .emits // empty' "$chain_file" 2>/dev/null)"
    [[ -n "$expected_event" && "$expected_event" != "null" ]] || return 0

    local event_file event_name event_name_lower expected_event_lower source_name
    expected_event_lower="$(printf '%s' "$expected_event" | tr '[:upper:]' '[:lower:]')"
    for event_file in "$events_dir"/*; do
        [[ -f "$event_file" ]] || continue

        event_name="$(grep -im1 "^event:" "$event_file" 2>/dev/null | sed 's/^[Ee]vent:[[:space:]]*//' | xargs)"
        source_name="$(grep -im1 "^source:" "$event_file" 2>/dev/null | sed 's/^[Ss]ource:[[:space:]]*//' | xargs)"
        if [[ -z "$event_name" && -z "$source_name" ]] && jq -e . "$event_file" >/dev/null 2>&1; then
            event_name="$(jq -r '.event // .event_name // empty' "$event_file" 2>/dev/null)"
            source_name="$(jq -r '.source // .source_agent // .agent // empty' "$event_file" 2>/dev/null)"
        fi
        event_name_lower="$(printf '%s' "$event_name" | tr '[:upper:]' '[:lower:]')"

        [[ "$event_name_lower" == "$expected_event_lower" ]] || continue
        printf '%s\n' "$source_name" | grep -qiF "$agent_id" || continue

        echo "$event_file"
        return 0
    done
}

monitor_stale_nudge_fallback() {
    local stale_count="${1:-1}"

    if [[ "$stale_count" -le 2 ]]; then
        echo "Resume only the current assigned task. If it is complete, write its event file and make the final non-empty line exactly AGENT_COMPLETE."
    elif [[ "$stale_count" -le 4 ]]; then
        echo "You look stalled. State the blocker in one sentence, then continue the assigned task or write the event file and finish with AGENT_COMPLETE."
    else
        echo "Stop waiting. Finish only the assigned task: write required artifacts, write the event file, and make your final non-empty line exactly AGENT_COMPLETE."
    fi
}

monitor_sanitize_nudge() {
    local nudge="$1"
    local stale_count="${2:-1}"
    local trimmed lower

    trimmed="$(printf '%s' "$nudge" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")"
    lower="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]' | tr '\r\n\t' '   ' | sed 's/[[:space:]]\+/ /g;s/^[[:space:]]*//;s/[[:space:]]*$//')"

    if [[ -z "$lower" ]] || printf '%s\n' "$lower" | grep -Eq '^(proceed|continue|go|k|ok|yes|y)([[:space:]]+(proceed|continue|go|k|ok|yes|y))*[.!]*$'; then
        monitor_stale_nudge_fallback "$stale_count"
        return 0
    fi

    printf '%s\n' "$trimmed"
}

monitor_should_ask_advisor() {
    local stale_count="${1:-0}"
    local threshold="${2:-${MENTIKO_ADVISOR_STALE_COUNT:-3}}"

    [[ "$stale_count" -ge "$threshold" ]]
}

monitor_stale_advisor_message() {
    local stale_count="${1:-1}"
    local session_name="${2:-}"
    local agent_context="${3:-}"
    local check_interval="${4:-60}"
    local profile_name="${MENTIKO_MONITOR_PROFILE:-mentiko}"
    local profile_file="$MONITOR_COMPLETION_DIR/monitor-profiles/${profile_name}.md"
    local advisor_cli="${MENTIKO_MONITOR_CLI:-}"
    local advisor_profile_id="${MENTIKO_MONITOR_PROFILE_ID:-}"
    local advisor_command=""
    local full_pane total_lines pane_top pane_bottom profile_content prompt response

    [[ -n "$session_name" ]] || return 1
    [[ -f "$profile_file" ]] || return 1
    declare -f transport_capture >/dev/null 2>&1 || return 1

    if [[ -n "$advisor_profile_id" ]] && declare -f build_profile_command >/dev/null 2>&1; then
        local advisor_profile_file
        advisor_profile_file="$(agent_profile_path "$advisor_profile_id")"
        [[ -f "$advisor_profile_file" ]] || return 1
        advisor_command="$(build_profile_command "$advisor_profile_file")"
    elif [[ -n "$advisor_cli" ]]; then
        command -v "$advisor_cli" >/dev/null 2>&1 || return 1
    else
        return 1
    fi

    full_pane="$(transport_capture "$session_name" 2>/dev/null || true)"
    [[ -n "$full_pane" ]] || return 1

    total_lines="$(printf '%s\n' "$full_pane" | wc -l | tr -d ' ')"
    pane_top="$(printf '%s\n' "$full_pane" | head -150)"
    pane_bottom="$(printf '%s\n' "$full_pane" | tail -400)"
    profile_content="$(cat "$profile_file")"

    prompt="AGENT SESSION CAPTURE (${total_lines} total lines)

== TOP OF SESSION (task assignment, first 150 lines) ==
${pane_top}

== BOTTOM OF SESSION (current state, last 400 lines) ==
${pane_bottom}

== END OF CAPTURE ==

---

MONITORING CONTEXT:
- Session: ${session_name}
- Stale count: ${stale_count} (no output change in $((stale_count * check_interval))+ seconds)
- Agent context: ${agent_context}

---

${profile_content}

---

Now output exactly ONE message as Mentiko would send it. Nothing else."

    if [[ -n "$advisor_command" ]]; then
        response="$(printf '%s' "$prompt" | bash -lc "$advisor_command" 2>/dev/null | head -10 || true)"
    else
        response="$("$advisor_cli" -p "$prompt" 2>/dev/null | head -10 || true)"
    fi
    [[ -n "$response" ]] || return 1

    monitor_sanitize_nudge "$response" "$stale_count"
}

monitor_stale_nudge_message() {
    local stale_count="${1:-1}"
    local session_name="${2:-}"
    local agent_context="${3:-}"
    local check_interval="${4:-60}"
    local nudge=""

    if nudge="$(monitor_stale_advisor_message "$stale_count" "$session_name" "$agent_context" "$check_interval" 2>/dev/null)"; then
        monitor_sanitize_nudge "$nudge" "$stale_count"
        return 0
    fi

    monitor_stale_nudge_fallback "$stale_count"
}
