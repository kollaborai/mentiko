#!/bin/bash
# profiler.sh - agent performance profiling
#
# tracks execution time, memory usage, token counts per agent
# writes metrics to agents/profiles/[session].json
#
# usage:
#   source profiler.sh
#   profiler-start <session> <agent-id> <agent-name>
#   profiler-snapshot <session> [label]
#   profiler-record-tokens <session> <model> <input> <output>
#   profiler-end <session> [status]
#   profiler-get <session>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# load config for namespace paths
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# load transport layer for session management
source "$SCRIPT_DIR/session-transport.sh" 2>/dev/null || true

# profiles directory (use config.sh PROFILES_DIR, fallback to project root)
PROFILER_DIR="${PROFILES_DIR:-${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/profiles}"
mkdir -p "$PROFILER_DIR"

# -------------------------------------------------------------------
# profiler-start: start profiling a session
# -------------------------------------------------------------------
# args: <session> <agent-id> <agent-name> [run-id]
profiler-start() {
    local session="$1"
    local agent_id="$2"
    local agent_name="${3:-$agent_id}"
    local run_id="${4:-}"

    local profile_file="$PROFILER_DIR/${session}.json"
    local timestamp=$(date -Iseconds)
    local start_epoch=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")

    # init profile
    cat > "$profile_file" <<EOF
{
  "session": "$session",
  "agent_id": "$agent_id",
  "agent_name": "$agent_name",
  "run_id": "$run_id",
  "started_at": "$timestamp",
  "start_epoch": $start_epoch,
  "status": "running",
  "snapshots": [],
  "api_calls": [],
  "tokens": {
    "total_input": 0,
    "total_output": 0,
    "total": 0,
    "by_model": {}
  },
  "memory_samples": [],
  "peak_memory_mb": 0,
  "cpu_samples": [],
  "avg_cpu_pct": 0
}
EOF

    echo "$profile_file"
}

# -------------------------------------------------------------------
# profiler-snapshot: capture current metrics snapshot
# -------------------------------------------------------------------
# args: <session> [label]
profiler-snapshot() {
    local session="$1"
    local label="${2:-snapshot}"

    local profile_file="$PROFILER_DIR/${session}.json"
    [[ -f "$profile_file" ]] || return 1

    local timestamp=$(date -Iseconds)
    local epoch=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")

    # get session pid from transport layer
    local pid=""
    local session_name="$session"

    if transport_has_session "$session_name" 2>/dev/null; then
        pid=$(transport_pid "$session_name" 2>/dev/null)
    fi

    # get memory/cpu if we have a pid
    local mem_mb=0
    local cpu_pct=0.0

    if [[ -n "$pid" && -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
        # get rss in kb, convert to mb
        local rss_kb=$(ps -p "$pid" -o rss= 2>/dev/null | tr -d ' ')
        if [[ -n "$rss_kb" ]]; then
            mem_mb=$((rss_kb / 1024))
        fi

        # get cpu
        cpu_pct=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
        [[ -z "$cpu_pct" ]] && cpu_pct=0.0
    fi

    # add snapshot
    jq --arg label "$label" \
       --arg ts "$timestamp" \
       --argjson epoch "$epoch" \
       --argjson mem "$mem_mb" \
       --argjson cpu "$cpu_pct" \
       '.snapshots += [{
           label: $label,
           timestamp: $ts,
           epoch: $epoch,
           memory_mb: $mem,
           cpu_pct: $cpu
       }] |
       .memory_samples += [$mem] |
       .cpu_samples += [$cpu] |
       if $mem > .peak_memory_mb then .peak_memory_mb = $mem end |
       .avg_cpu_pct = ((.cpu_samples | add) / (.cpu_samples | length))' \
       "$profile_file" > "$profile_file.tmp"
    mv "$profile_file.tmp" "$profile_file"
}

# -------------------------------------------------------------------
# profiler-record-tokens: record an api call's token usage
# -------------------------------------------------------------------
# args: <session> <model> <input-tokens> <output-tokens> [duration-ms]
profiler-record-tokens() {
    local session="$1"
    local model="$2"
    local input_tokens="${3:-0}"
    local output_tokens="${4:-0}"
    local duration_ms="${5:-0}"

    local profile_file="$PROFILER_DIR/${session}.json"
    [[ -f "$profile_file" ]] || return 1

    local total=$((input_tokens + output_tokens))
    local timestamp=$(date -Iseconds)

    # add api call and update totals
    jq --arg model "$model" \
       --arg ts "$timestamp" \
       --argjson in_t "$input_tokens" \
       --argjson out_t "$output_tokens" \
       --argjson total "$total" \
       --argjson dur "$duration_ms" \
       '.api_calls += [{
           model: $model,
           timestamp: $ts,
           input_tokens: $in_t,
           output_tokens: $out_t,
           total_tokens: $total,
           duration_ms: $dur
       }] |
       .tokens.total_input += $in_t |
       .tokens.total_output += $out_t |
       .tokens.total += $total |
       .tokens.by_model[$model] = (.tokens.by_model[$model] // {input:0, output:0, total:0}) |
       .tokens.by_model[$model].input += $in_t |
       .tokens.by_model[$model].output += $out_t |
       .tokens.by_model[$model].total += $total' \
       "$profile_file" > "$profile_file.tmp"
    mv "$profile_file.tmp" "$profile_file"
}

# -------------------------------------------------------------------
# profiler-end: finalize profiling
# -------------------------------------------------------------------
# args: <session> [status] [error-msg]
profiler-end() {
    local session="$1"
    local status="${2:-complete}"
    local error_msg="${3:-}"

    local profile_file="$PROFILER_DIR/${session}.json"
    [[ -f "$profile_file" ]] || return 1

    local timestamp=$(date -Iseconds)
    local end_epoch=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")

    # calculate duration, take final snapshot, set status
    local updated=$(jq --arg st "$status" \
       --arg ts "$timestamp" \
       --argjson end_epoch "$end_epoch" \
       --arg err "$error_msg" \
       '.status = $st |
        .ended_at = $ts |
        .end_epoch = $end_epoch |
        .duration_ms = ($end_epoch - .start_epoch) |
        if $err != "" then .error = $err end |
        .final_snapshot = {
           timestamp: $ts,
           memory_mb: .peak_memory_mb,
           cpu_pct: .avg_cpu_pct
        }' \
       "$profile_file")

    echo "$updated" > "$profile_file.tmp"
    mv "$profile_file.tmp" "$profile_file"

    echo "$profile_file"
}

# -------------------------------------------------------------------
# profiler-get: get profile data
# -------------------------------------------------------------------
# args: <session> [format] (json|text)
profiler-get() {
    local session="$1"
    local format="${2:-json}"

    local profile_file="$PROFILER_DIR/${session}.json"

    if [[ ! -f "$profile_file" ]]; then
        echo '{"error": "profile not found"}'
        return 1
    fi

    if [[ "$format" == "text" ]]; then
        profiler-format-text "$profile_file"
    else
        cat "$profile_file"
    fi
}

# -------------------------------------------------------------------
# profiler-format-text: format profile as readable text
# -------------------------------------------------------------------
profiler-format-text() {
    local profile_file="$1"

    local session=$(jq -r '.session' "$profile_file")
    local agent_name=$(jq -r '.agent_name' "$profile_file")
    local status=$(jq -r '.status' "$profile_file")
    local duration_ms=$(jq -r '.duration_ms // 0' "$profile_file")
    local total_tokens=$(jq -r '.tokens.total // 0' "$profile_file")
    local peak_mem=$(jq -r '.peak_memory_mb // 0' "$profile_file")
    local avg_cpu=$(jq -r '.avg_cpu_pct // 0' "$profile_file")
    local api_calls=$(jq -r '.api_calls | length' "$profile_file")

    echo ""
    echo "  profile: $session"
    echo "  agent:   $agent_name"
    echo "  status:  $status"
    echo "  ---"
    echo "  duration:    $((duration_ms / 1000000000))s"
    echo "  api calls:   $api_calls"
    echo "  tokens:      $total_tokens"
    echo "  peak memory: ${peak_mem}MB"
    echo "  avg cpu:     ${avg_cpu}%"
    echo ""
}

# -------------------------------------------------------------------
# profiler-list: list all profiles
# -------------------------------------------------------------------
profiler-list() {
    local format="${1:-short}"

    echo ""
    echo "  profiles:"
    echo "  ---"

    for f in "$PROFILER_DIR"/*.json; do
        [[ -f "$f" ]] || continue

        local session=$(jq -r '.session' "$f")
        local agent=$(jq -r '.agent_name' "$f")
        local status=$(jq -r '.status' "$f")
        local duration=$(jq -r '(.duration_ms // 0) / 1000000000' "$f")
        local tokens=$(jq -r '.tokens.total // 0' "$f")

        if [[ "$format" == "short" ]]; then
            printf "    %-20s %-15s %-10s %4ds %5d tokens\n" \
                "$session" "$agent" "$status" "${duration%.*}" "$tokens"
        else
            echo "    $session"
            echo "      agent:     $agent"
            echo "      status:    $status"
            echo "      duration:  ${duration}s"
            echo "      tokens:    $tokens"
            echo ""
        fi
    done
}

# -------------------------------------------------------------------
# profiler-compare: compare multiple sessions
# -------------------------------------------------------------------
# args: <session1> <session2> ...
profiler-compare() {
    local sessions=("$@")

    echo ""
    echo "  comparison:"
    echo "  ---"
    printf "    %-20s %-12s %10s %10s %10s %10s\n" \
        "session" "status" "duration" "tokens" "mem(mb)" "cpu(%)"
    echo "    $(printf '%.0s-' {1..70})"

    for session in "${sessions[@]}"; do
        local profile_file="$PROFILER_DIR/${session}.json"
        [[ -f "$profile_file" ]] || continue

        local status=$(jq -r '.status' "$profile_file")
        local duration=$(jq -r '(.duration_ms // 0) / 1000000000' "$profile_file")
        local tokens=$(jq -r '.tokens.total // 0' "$profile_file")
        local mem=$(jq -r '.peak_memory_mb // 0' "$profile_file")
        local cpu=$(jq -r '.avg_cpu_pct // 0' "$profile_file")

        printf "    %-20s %-12s %10s %10s %10s %10s\n" \
            "$session" "$status" "${duration}s" "$tokens" "$mem" "${cpu}%"
    done
    echo ""
}

# -------------------------------------------------------------------
# profiler-aggregate: aggregate stats across all sessions
# -------------------------------------------------------------------
profiler-aggregate() {
    local run_id="${1:-}"

    echo ""
    echo "  aggregate stats:"
    echo "  ---"

    local total_duration=0
    local total_tokens=0
    local total_calls=0
    local count=0

    for f in "$PROFILER_DIR"/*.json; do
        [[ -f "$f" ]] || continue

        # filter by run_id if specified
        if [[ -n "$run_id" ]]; then
            local file_run_id=$(jq -r '.run_id // ""' "$f")
            [[ "$file_run_id" == "$run_id" ]] || continue
        fi

        local duration=$(jq -r '.duration_ms // 0' "$f")
        local tokens=$(jq -r '.tokens.total // 0' "$f")
        local calls=$(jq -r '.api_calls | length' "$f")

        total_duration=$((total_duration + duration))
        total_tokens=$((total_tokens + tokens))
        total_calls=$((total_calls + calls))
        count=$((count + 1))
    done

    echo "  sessions:     $count"
    echo "  total time:   $((total_duration / 1000000000))s"
    echo "  total tokens: $total_tokens"
    echo "  total calls:  $total_calls"
    if [[ $count -gt 0 ]]; then
        echo "  avg time:     $((total_duration / count / 1000000000))s"
        echo "  avg tokens:   $((total_tokens / count))"
    fi
    echo ""
}

# -------------------------------------------------------------------
# profiler-export: export profiles for dashboard
# -------------------------------------------------------------------
# args: [output-file]
profiler-export() {
    local output="${1:-$PROFILER_DIR/export.json}"

    local tmp=$(mktemp)
    echo '{"profiles":[]}' > "$tmp"

    for f in "$PROFILER_DIR"/*.json; do
        [[ -f "$f" ]] || continue

        tmp2=$(mktemp)
        jq --slurpfile profile "$f" '.profiles += $profile' "$tmp" > "$tmp2"
        mv "$tmp2" "$tmp"
    done

    mv "$tmp" "$output"
    echo "$output"
}

# -------------------------------------------------------------------
# profiler-cleanup: remove old profiles
# -------------------------------------------------------------------
# args: [days]
profiler-cleanup() {
    local days="${1:-30}"

    find "$PROFILER_DIR" -type f -name "*.json" -mtime +$days -delete 2>/dev/null
    echo "  cleaned profiles older than ${days} days"
}

# export functions
export -f profiler-start
export -f profiler-snapshot
export -f profiler-record-tokens
export -f profiler-end
export -f profiler-get
export -f profiler-list
export -f profiler-compare
export -f profiler-aggregate
export -f profiler-export
export -f profiler-cleanup
export -f profiler-format-text
