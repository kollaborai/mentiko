#!/bin/bash
# monitor-completion.sh - helpers for safe monitor completion detection

MONITOR_COMPLETION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$MONITOR_COMPLETION_DIR/terminal-sanitize.sh"
source "$MONITOR_COMPLETION_DIR/agent-profile-client.sh"

monitor_agent_id_for_session() {
    local session_name="$1"
    local chain_file="$2"
    local derived_prefix="${3:-$session_name}"

    if [[ -n "${MENTIKO_AGENT_ID:-}" ]]; then
        local explicit_count
        explicit_count=$(jq -r --arg id "$MENTIKO_AGENT_ID" \
            '[.agents[]? | select(.id == $id)] | length' "$chain_file" 2>/dev/null || echo 0)
        if [[ "$explicit_count" -eq 1 ]]; then
            echo "$MENTIKO_AGENT_ID"
            return 0
        fi
        echo "error: configured agent id '$MENTIKO_AGENT_ID' is not unique in $chain_file" >&2
        return 1
    fi

    [[ -f "$chain_file" ]] || return 0

    local chain_prefix
    chain_prefix=$(jq -r '.config.session_prefix // empty' "$chain_file" 2>/dev/null || true)
    local -a candidates=("$derived_prefix")
    if [[ -n "$chain_prefix" && "$derived_prefix" == "$chain_prefix-"* ]]; then
        candidates+=("${derived_prefix#"$chain_prefix-"}")
    fi

    local agent_id="" configured_prefix="" candidate=""
    local -a exact_matches=()
    while IFS=$'\t' read -r agent_id configured_prefix; do
        [[ -n "$agent_id" && "$agent_id" != "null" ]] || continue
        for candidate in "${candidates[@]}"; do
            if [[ "$candidate" == "$agent_id" ]] \
               || [[ -n "$configured_prefix" && "$configured_prefix" != "null" && "$candidate" == "$configured_prefix" ]]; then
                if [[ " ${exact_matches[*]} " != *" $agent_id "* ]]; then
                    exact_matches+=("$agent_id")
                fi
            fi
        done
    done < <(jq -r '.agents[]? | [(.id // ""), (.session_prefix // "")] | @tsv' "$chain_file" 2>/dev/null)

    if [[ "${#exact_matches[@]}" -eq 1 ]]; then
        echo "${exact_matches[0]}"
        return 0
    fi
    if [[ "${#exact_matches[@]}" -gt 1 ]]; then
        echo "error: session '$session_name' has ambiguous exact agent matches: ${exact_matches[*]}" >&2
        return 1
    fi

    local -a token_matches=()
    while IFS= read -r agent_id; do
        [[ -n "$agent_id" && "$agent_id" != "null" ]] || continue
        for candidate in "$session_name" "${candidates[@]}"; do
            if [[ "-$candidate-" == *"-$agent_id-"* ]]; then
                if [[ " ${token_matches[*]} " != *" $agent_id "* ]]; then
                    token_matches+=("$agent_id")
                fi
            fi
        done
    done < <(jq -r '.agents[]?.id // empty' "$chain_file" 2>/dev/null)

    if [[ "${#token_matches[@]}" -eq 1 ]]; then
        echo "${token_matches[0]}"
        return 0
    fi
    if [[ "${#token_matches[@]}" -gt 1 ]]; then
        echo "error: session '$session_name' ambiguously matches agent ids: ${token_matches[*]}" >&2
        return 1
    fi

    echo "error: session '$session_name' does not uniquely identify a chain agent" >&2
    return 1
}

monitor_completion_event_file() {
    local session_name="$1"
    local chain_file="$2"
    local events_dir="$3"
    local agent_id="${4:-}"
    local run_id="${5:-${MENTIKO_RUN_ID:-${RUN_ID:-}}}"

    [[ -f "$chain_file" ]] || return 0
    if [[ -z "$events_dir" || ! -d "$events_dir" ]]; then
        echo "error: configured EVENTS_DIR is unavailable" >&2
        return 1
    fi
    if [[ -z "$run_id" ]]; then
        echo "error: completion-event lookup requires a run id" >&2
        return 1
    fi

    if [[ -z "$agent_id" ]]; then
        if ! agent_id="$(monitor_agent_id_for_session "$session_name" "$chain_file")"; then
            return 1
        fi
    fi
    [[ -n "$agent_id" ]] || return 0

    local expected_event
    expected_event="$(jq -r --arg id "$agent_id" '.agents[]? | select(.id == $id) | .emits // empty' "$chain_file" 2>/dev/null)"
    [[ -n "$expected_event" && "$expected_event" != "null" ]] || return 0

    if [[ -z "${MENTIKO_CODE_ROOT:-}" ]]; then
        echo "error: MENTIKO_CODE_ROOT must be configured" >&2
        return 1
    fi
    local lifecycle="$MENTIKO_CODE_ROOT/lib/runner-event-lifecycle.js"
    local args=(
        find
        --events-dir "$events_dir"
        --run-id "$run_id"
        --expected-event "$expected_event"
        --agent-id "$agent_id"
        --session-name "$session_name"
        --output text
    )
    local sibling_id
    while IFS= read -r sibling_id; do
        [[ -n "$sibling_id" && "$sibling_id" != "null" ]] || continue
        args+=(--all-agent-id "$sibling_id")
    done < <(jq -r '.agents[]?.id // empty' "$chain_file" 2>/dev/null)

    local result=""
    if result="$(node "$lifecycle" "${args[@]}")"; then
        printf '%s\n' "$result"
        return 0
    else
        local rc=$?
        if [[ "$rc" -eq 3 ]]; then
            return 0
        fi
    fi
    echo "error: typed completion-event lookup failed" >&2
    return 1
}

monitor_expected_event_for_session() {
    local session_name="$1"
    local chain_file="$2"
    local agent_id="${3:-}"

    [[ -f "$chain_file" ]] || return 0

    if [[ -z "$agent_id" ]]; then
        if ! agent_id="$(monitor_agent_id_for_session "$session_name" "$chain_file")"; then
            return 1
        fi
    fi
    [[ -n "$agent_id" ]] || return 0

    jq -r --arg id "$agent_id" '.agents[]? | select(.id == $id) | .emits // empty' "$chain_file" 2>/dev/null
}

monitor_emit_command_hint() {
    local session_name="$1"
    local chain_file="$2"
    local agent_id="${3:-}"
    local expected_event=""

    [[ -f "$chain_file" ]] || return 0

    if [[ -z "$agent_id" ]]; then
        if ! agent_id="$(monitor_agent_id_for_session "$session_name" "$chain_file")"; then
            return 1
        fi
    fi
    [[ -n "$agent_id" ]] || return 0

    expected_event="$(monitor_expected_event_for_session "$session_name" "$chain_file" "$agent_id")"
    [[ -n "$expected_event" && "$expected_event" != "null" ]] || return 0

    printf 'mentiko emit %s %s' "$expected_event" "$agent_id"
}

monitor_stale_nudge_fallback() {
    local stale_count="${1:-1}"
    local session_name="${2:-}"
    local chain_file="${3:-${CHAIN_FILE:-}}"
    local emit_hint=""

    if [[ -n "$session_name" && -n "$chain_file" ]]; then
        emit_hint="$(monitor_emit_command_hint "$session_name" "$chain_file" 2>/dev/null || true)"
    fi

    if [[ -n "$emit_hint" ]]; then
        if [[ "$stale_count" -le 2 ]]; then
            echo "Resume only the current assigned task. If it is complete, write any required artifacts, run your exact completion command (${emit_hint}), and make the final non-empty line exactly AGENT_COMPLETE."
        elif [[ "$stale_count" -le 4 ]]; then
            echo "You look stalled. State the blocker in one sentence, then continue the assigned task or, if done, write your required artifacts, run your exact completion command (${emit_hint}), and finish with AGENT_COMPLETE."
        else
            echo "Stop waiting. Finish only the assigned task: write required artifacts, run your exact completion command (${emit_hint}), and make your final non-empty line exactly AGENT_COMPLETE. Do not hand-write event files or invent another event name."
        fi
        return 0
    fi

    if [[ "$stale_count" -le 2 ]]; then
        echo "Resume only the current assigned task. If it is complete, write any required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE."
    elif [[ "$stale_count" -le 4 ]]; then
        echo "You look stalled. State the blocker in one sentence, then continue the assigned task or, if done, write your required artifacts, run your completion command (mentiko emit), and finish with AGENT_COMPLETE."
    else
        echo "Stop waiting. Finish only the assigned task: write required artifacts, run your completion command (mentiko emit), and make your final non-empty line exactly AGENT_COMPLETE. Do not hand-write event files."
    fi
}

monitor_sanitize_nudge() {
    local nudge="$1"
    local stale_count="${2:-1}"
    local trimmed lower

    trimmed="$(printf '%s' "$nudge" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")"
    lower="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]' | tr '\r\n\t' '   ' | sed 's/[[:space:]]\+/ /g;s/^[[:space:]]*//;s/[[:space:]]*$//')"

    if printf '%s\n' "$lower" | grep -Eq '(llm provider not available|profile missing required|use /profile|api_key|api_token|configuration error|no provider could be auto-detected)'; then
        monitor_stale_nudge_fallback "$stale_count"
        return 0
    fi

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
    local advisor_profile_id="${MENTIKO_MONITOR_PROFILE_ID:-}"
    local advisor_command=""
    local full_pane total_lines pane_top pane_bottom profile_content prompt response

    [[ -n "$session_name" ]] || return 1
    [[ -f "$profile_file" ]] || return 1
    declare -f transport_capture >/dev/null 2>&1 || return 1

    if [[ -n "$advisor_profile_id" ]]; then
        local advisor_profile_json advisor_profile_file
        advisor_profile_json="$(agent_profile_select_json "${AGENT_PROFILES_DIR:?AGENT_PROFILES_DIR must be configured}" "$advisor_profile_id" 2>/dev/null || true)"
        advisor_profile_file="$(printf '%s' "$advisor_profile_json" | jq -r '.path // empty' 2>/dev/null)"
        [[ -n "$advisor_profile_file" ]] || return 1
        advisor_command="$(agent_profile_command "$advisor_profile_file" false "${NAMESPACE_ID:-default}" "${ORG_ID:-default}" 2>/dev/null || true)"
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

    response="$(printf '%s' "$prompt" | bash -lc "$advisor_command" 2>/dev/null | head -10 || true)"
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

    monitor_stale_nudge_fallback "$stale_count" "$session_name" "${CHAIN_FILE:-}"
}
