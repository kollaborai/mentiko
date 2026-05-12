#!/bin/bash
# performance.sh - agent performance and cost tracking
#
# tracks:
# - ai api calls per agent (count, tokens)
# - execution time per agent
# - resource usage (cpu, memory)
# - cost estimates based on tokens
#
# usage:
#   source performance.sh
#   perf-start-agent <run-id> <agent-id> <session-name>
#   perf-record-api-call <run-id> <agent-id> <model> <input-tokens> <output-tokens>
#   perf-end-agent <run-id> <agent-id>
#   perf-get-report <run-id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# load config for namespace paths
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# performance directory (use config.sh METRICS_DIR, fallback to namespace root)
PERF_DIR="${METRICS_DIR:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}/metrics}"
mkdir -p "$PERF_DIR"

# pricing (per 1M tokens, feb 2025)
# update these as models change
declare -A MODEL_PRICES_INPUT=(
    ["claude-opus-4-6"]=15.0
    ["claude-sonnet-4-6"]=3.0
    ["claude-haiku-4-5"]=0.80
    ["gpt-4o"]=2.50
    ["gpt-4o-mini"]=0.15
    ["o3-mini"]=1.10
    ["default"]=3.0
)

declare -A MODEL_PRICES_OUTPUT=(
    ["claude-opus-4-6"]=75.0
    ["claude-sonnet-4-6"]=15.0
    ["claude-haiku-4-5"]=4.0
    ["gpt-4o"]=10.0
    ["gpt-4o-mini"]=0.60
    ["o3-mini"]=11.0
    ["default"]=15.0
)

# -------------------------------------------------------------------
# perf-get-price: get price per 1M tokens for model
# -------------------------------------------------------------------
# args: <model> <type> (input|output)
perf-get-price() {
    local model="$1"
    local type="${2:-input}"
    local key="MODEL_PRICES_${type^^}"

    # exact match
    local price="${MODEL_PRICES_INPUT[$model]:-}"
    [[ "$type" == "output" ]] && price="${MODEL_PRICES_OUTPUT[$model]:-}"

    # fallback
    [[ -z "$price" ]] && price="${MODEL_PRICES_INPUT[default]:-3.0}"
    [[ "$type" == "output" ]] && price="${MODEL_PRICES_OUTPUT[default]:-15.0}"

    echo "$price"
}

# -------------------------------------------------------------------
# perf-start-agent: start tracking an agent
# -------------------------------------------------------------------
# args: <run-id> <agent-id> <session-name> [agent-name]
perf-start-agent() {
    local run_id="$1"
    local agent_id="$2"
    local session="$3"
    local agent_name="${4:-$agent_id}"

    local perf_file="$PERF_DIR/$run_id/performance.json"
    mkdir -p "$(dirname "$perf_file")"

    # init if not exists
    if [[ ! -f "$perf_file" ]]; then
        cat > "$perf_file" <<'EOF'
{
  "run_id": "",
  "started": "",
  "agents": {},
  "summary": {
    "total_api_calls": 0,
    "total_tokens": 0,
    "total_cost_usd": 0,
    "total_duration_ms": 0
  }
}
EOF
    fi

    local timestamp=$(date -Iseconds)
    local start_epoch=$(date +%s%N)

    # add agent entry
    jq --arg run_id "$run_id" \
       --arg agent_id "$agent_id" \
       --arg session "$session" \
       --arg name "$agent_name" \
       --arg ts "$timestamp" \
       --arg start_ms "$start_epoch" '
        .run_id = $run_id |
        .started = (if .started == "" then $ts else .started end) |
        .agents[$agent_id] = {
            id: $agent_id,
            name: $name,
            session: $session,
            started: $ts,
            start_ms: ($start_ms | tonumber),
            status: "running",
            api_calls: [],
            total_calls: 0,
            total_tokens: 0,
            total_cost_usd: 0,
            duration_ms: 0
        }
    ' "$perf_file" > "$perf_file.tmp"
    mv "$perf_file.tmp" "$perf_file"
}

# -------------------------------------------------------------------
# perf-record-api-call: record an ai api call
# -------------------------------------------------------------------
# args: <run-id> <agent-id> <model> <input-tokens> <output-tokens> [call-duration-ms]
perf-record-api-call() {
    local run_id="$1"
    local agent_id="$2"
    local model="$3"
    local in_tokens="${4:-0}"
    local out_tokens="${5:-0}"
    local duration_ms="${6:-0}"

    local perf_file="$PERF_DIR/$run_id/performance.json"
    [[ -f "$perf_file" ]] || return 1

    # get prices
    local price_in=$(perf-get-price "$model" "input")
    local price_out=$(perf-get-price "$model" "output")

    # calculate cost (tokens / 1M * price)
    local cost=$(awk "BEGIN {printf \"%.6f\", ($in_tokens / 1000000 * $price_in) + ($out_tokens / 1000000 * $price_out)}")

    local total_tokens=$((in_tokens + out_tokens))
    local timestamp=$(date -Iseconds)

    # add call to agent
    local tmp=$(jq --arg aid "$agent_id" \
       --arg model "$model" \
       --arg ts "$timestamp" \
       --argjson in_t "$in_tokens" \
       --argjson out_t "$out_tokens" \
       --argjson tot_t "$total_tokens" \
       --argjson cost "$cost" \
       --argjson dur "$duration_ms" '
        .agents[$aid].api_calls += [{
            model: $model,
            timestamp: $ts,
            input_tokens: $in_t,
            output_tokens: $out_t,
            total_tokens: $tot_t,
            cost_usd: $cost,
            duration_ms: $dur
        }] |
        .agents[$aid].total_calls += 1 |
        .agents[$aid].total_tokens += $tot_t |
        .agents[$aid].total_cost_usd += $cost
    ' "$perf_file")

    echo "$tmp" > "$perf_file.tmp"
    mv "$perf_file.tmp" "$perf_file"
}

# -------------------------------------------------------------------
# perf-end-agent: mark agent complete
# -------------------------------------------------------------------
# args: <run-id> <agent-id> [status]
perf-end-agent() {
    local run_id="$1"
    local agent_id="$2"
    local status="${3:-complete}"

    local perf_file="$PERF_DIR/$run_id/performance.json"
    [[ -f "$perf_file" ]] || return 1

    local end_epoch=$(date +%s%N)

    # calculate duration and update summary
    local updated=$(jq --arg aid "$agent_id" \
       --arg st "$status" \
       --argjson end_ms "$end_epoch" '
        .agents[$aid].status = $st |
        .agents[$aid].end_ms = $end_ms |
        .agents[$aid].duration_ms = ($end_ms - .agents[$aid].start_ms) |
        .summary.total_calls = ([
            .agents | to_entries[] | .value.total_calls
        ] | add // 0) |
        .summary.total_tokens = ([
            .agents | to_entries[] | .value.total_tokens
        ] | add // 0) |
        .summary.total_cost_usd = ([
            .agents | to_entries[] | .value.total_cost_usd
        ] | add // 0) |
        .summary.total_duration_ms = ([
            .agents | to_entries[] | .value.duration_ms
        ] | add // 0)
    ' "$perf_file")

    echo "$updated" > "$perf_file.tmp"
    mv "$perf_file.tmp" "$perf_file"
}

# -------------------------------------------------------------------
# perf-record-resource: record resource usage snapshot
# -------------------------------------------------------------------
# args: <run-id> <agent-id>
# measures current cpu/memory of agent session (via pty-manager)
perf-record-resource() {
    local run_id="$1"
    local agent_id="$2"

    local perf_file="$PERF_DIR/$run_id/performance.json"
    [[ -f "$perf_file" ]] || return 1

    # get session name from perf file
    local session=$(jq -r --arg aid "$agent_id" '.agents[$aid].session // ""' "$perf_file")
    [[ -z "$session" ]] && return 1

    # get pid from pty-manager via transport layer
    local pid
    pid=$(transport_pid "$session" 2>/dev/null | tr -d '[:space:]')
    [[ -z "$pid" ]] && return 1

    # get cpu and memory (macos linux compatible)
    local stats=""
    if command -v ps &> /dev/null; then
        # get cpu and memory percentage
        stats=$(ps -p $pid -o %cpu,%mem,etime 2>/dev/null | tail -1 | awk '{cpu=$1; mem=$2; time=$3; printf "{\"cpu_pct\":%.1f,\"mem_pct\":%.1f,\"elapsed\":\"%s\"}", cpu, mem, time}')
    fi

    [[ -z "$stats" ]] && return 1

    # add to agent resource samples
    local timestamp=$(date -Iseconds)
    jq --arg aid "$agent_id" \
       --arg ts "$timestamp" \
       --argjson res "$stats" '
        .agents[$aid].resource_samples //= [] |
        .agents[$aid].resource_samples += [{timestamp: $ts} + $res]
    ' "$perf_file" > "$perf_file.tmp"
    mv "$perf_file.tmp" "$perf_file"
}

# -------------------------------------------------------------------
# perf-get-report: output performance report for a run
# -------------------------------------------------------------------
# args: <run-id> [format] (json|text)
perf-get-report() {
    local run_id="$1"
    local format="${2:-json}"

    local perf_file="$PERF_DIR/$run_id/performance.json"

    if [[ ! -f "$perf_file" ]]; then
        echo '{"error": "performance data not found"}'
        return 1
    fi

    if [[ "$format" == "text" ]]; then
        perf-format-text "$perf_file"
    else
        cat "$perf_file"
    fi
}

# -------------------------------------------------------------------
# perf-format-text: format report as readable text
# -------------------------------------------------------------------
perf-format-text() {
    local perf_file="$1"

    echo ""
    echo "  performance report:"
    echo "  ---"
    echo ""

    # summary
    local total_calls=$(jq -r '.summary.total_calls // 0' "$perf_file")
    local total_tokens=$(jq -r '.summary.total_tokens // 0' "$perf_file")
    local total_cost=$(jq -r '.summary.total_cost_usd // 0' "$perf_file")
    local total_dur=$(jq -r '.summary.total_duration_ms // 0' "$perf_file")

    echo "  summary:"
    echo "    api calls:     $total_calls"
    echo "    tokens:        $total_tokens"
    echo "    cost:          \$$(printf "%.4f" "$total_cost")"
    echo "    duration:      $((total_dur / 1000000000))s"
    echo ""

    # per agent
    echo "  agents:"
    jq -r '.agents | to_entries[] | "
    \(.value.name // .key):
      id:        \(.value.id)
      status:    \(.value.status)
      calls:     \(.value.total_calls)
      tokens:    \(.value.total_tokens)
      cost:      $\(.value.total_cost_usd)
      duration:  \((.value.duration_ms / 1000000000))s"' "$perf_file"
    echo ""
}

# -------------------------------------------------------------------
# perf-list-runs: list all runs with performance data
# -------------------------------------------------------------------
perf-list-runs() {
    local runs=()
    for d in "$PERF_DIR"/run-*; do
        [[ -d "$d" ]] || continue
        [[ -f "$d/performance.json" ]] || continue
        local run_id=$(basename "$d")
        local summary=$(jq -r '{id: .run_id, cost: .summary.total_cost_usd, tokens: .summary.total_tokens, agents: (.agents | length)}' "$d/performance.json")
        echo "$run_id $summary"
    done
}

# -------------------------------------------------------------------
# perf-cleanup: remove performance data older than N days
# -------------------------------------------------------------------
# args: [days]
perf-cleanup() {
    local days="${1:-30}"

    find "$PERF_DIR" -type d -name "run-*" -mtime +$days -exec rm -rf {} \; 2>/dev/null
    echo "  cleaned performance data older than ${days} days"
}

# export functions
export -f perf-start-agent
export -f perf-record-api-call
export -f perf-end-agent
export -f perf-record-resource
export -f perf-get-report
export -f perf-list-runs
export -f perf-cleanup
export -f perf-get-price
export -f perf-format-text
