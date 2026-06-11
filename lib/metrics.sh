#!/bin/bash
# metrics.sh - metrics and observability for mentiko
#
# usage:
#   source metrics.sh
#   metric-start-timer <timer-name>
#   metric-end-timer <timer-name> <metric-type>
#   metric-counter <metric-name> [<delta>]
#   metric-gauge <metric-name> <value>
#   get-metrics-json
#
# metrics stored in: ~/.mentiko-metrics/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# metrics directory
METRICS_DIR="${HOME}/.mentiko-metrics"
mkdir -p "$METRICS_DIR"

# counters file
COUNTERS_FILE="$METRICS_DIR/counters.json"
[[ -f "$COUNTERS_FILE" ]] || echo '{}' > "$COUNTERS_FILE"

# gauges file
GAUGES_FILE="$METRICS_DIR/gauges.json"
[[ -f "$GAUGES_FILE" ]] || echo '{}' > "$GAUGES_FILE"

# timers file
TIMERS_FILE="$METRICS_DIR/timers.json"
[[ -f "$TIMERS_FILE" ]] || echo '{}' > "$TIMERS_FILE"

# active timers (runtime only, not persisted)
ACTIVE_TIMERS_FILE="$METRICS_DIR/active-timers.json"
[[ -f "$ACTIVE_TIMERS_FILE" ]] || echo '{}' > "$ACTIVE_TIMERS_FILE"

# webhook metrics
WEBHOOK_METRICS_FILE="$METRICS_DIR/webhooks.json"
[[ -f "$WEBHOOK_METRICS_FILE" ]] || echo '{"total":0,"delivered":0,"failed":0,"by_event":{}}' > "$WEBHOOK_METRICS_FILE"

# ===================================================================
# metrics file lock (engine bug #21 — counters-race)
# ===================================================================
# THE PROBLEM: every writer below does `jq ... FILE > FILE.tmp && mv FILE.tmp FILE`,
# and ALL writers of a given file share the SAME ".tmp" path. Under concurrency (the
# load drill ran many chains at once) two writers race: A writes FILE.tmp, B writes
# FILE.tmp, A's `mv` renames B's half-written temp — or B's `mv` fails outright with
# `mv: cannot stat counters.json.tmp` (observed in 3 of 5 aborted runs at N≥8). A
# lost/garbled counter then corrupts the file and, worse, the failed `mv` returns
# non-zero — under the chain-runner's `set -e` + ERR trap that can abort the RUN.
#
# THE FIX: serialize each file's read-modify-write behind a per-file mkdir lock
# (same atomic-mkdir primitive as lib/run-lib.sh / routing-lib.sh, replicated here as
# a sibling so metrics.sh stays standalone — it's sourced in many contexts). A
# PER-PID temp file removes the shared-".tmp" clobber even if the lock is ever skipped.
#
# TIMEOUT POLICY — METRICS MUST NEVER BLOCK A RUN. Unlike run.json (where a dropped
# write is worse than a raced one, so it proceeds unlocked), a dropped metric is
# harmless. So on lock-acquire timeout we SKIP the write entirely with a stderr line
# and return 0. The wait budget is deliberately tiny (a handful of ~20ms ticks): a
# counter bump must add millisecond-scale latency to a launch, never stall it.

METRIC_LOCK_STALE_SECS="${METRIC_LOCK_STALE_SECS:-30}"    # a held metrics lock older than this is crashed
# Max ~20ms ticks to wait for the lock before SKIPPING the write. 150 ticks ≈ 3s: ample
# for real load (a handful of chains bumping counters occasionally — each jq RMW is
# ~5-15ms, so even a dozen simultaneous bumps serialize well under this) so writes are
# NOT lost in practice, while still bounding the wait so a pathological pile-up can
# never stall a run for more than a few seconds (it skips, logs, and moves on).
METRIC_LOCK_WAIT_TICKS="${METRIC_LOCK_WAIT_TICKS:-150}"

# _metric_lock_acquire <lock_dir> -> 0 acquired, 1 timed out (caller SKIPS the write).
#
# Breaks a held lock if the holder pid is provably gone (a holder that crashed without
# rmdir'ing) OR the dir has aged past the stale threshold. The dead-pid break keeps
# throughput high under churn: a holder that exited (even normally) is detected gone and
# its lock reclaimed immediately rather than waiting out the age window. To AVOID the
# stomp where a waiter breaks a lock the previous holder already released and a new
# holder just re-created, the break is re-raced safely — we rmdir then loop back to the
# atomic mkdir; if a new holder is already in, our rmdir simply fails (its dir is
# non-empty / owned) and we contend for the next mkdir rather than stealing the section.
# PERFORMANCE: the hot path is just `mkdir` (one syscall). The stale-check (cat pid +
# stat + date + kill -0 — several subprocess spawns) runs ONLY every ~25 ticks, not on
# every spin. Doing it every tick made spinning waiters spawn 150+ processes apiece and
# starve the lock HOLDER of CPU, which paradoxically caused waiters to time out and skip
# writes under heavy parallelism. Cheap spinning + periodic staleness keeps throughput
# high so writes land, while the periodic check still reclaims a genuinely crashed lock.
_metric_lock_acquire() {
    local lock_dir="$1" waited=0 holder mtime now age
    while true; do
        if mkdir "$lock_dir" 2>/dev/null; then
            echo "$$" > "$lock_dir/pid" 2>/dev/null || true
            return 0
        fi
        # periodic stale-break (every ~25 ticks ≈ 0.25s) — keeps the spin cheap.
        if (( waited % 25 == 0 )); then
            holder="$(cat "$lock_dir/pid" 2>/dev/null || echo "")"
            mtime="$(stat -c %Y "$lock_dir" 2>/dev/null || stat -f %m "$lock_dir" 2>/dev/null || echo 0)"
            now="$(date +%s)"; age=0; [[ "$mtime" -gt 0 ]] && age=$(( now - mtime ))
            if { [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; } \
               || [[ "$age" -ge "$METRIC_LOCK_STALE_SECS" ]]; then
                rm -f "$lock_dir/pid" 2>/dev/null || true
                rmdir "$lock_dir" 2>/dev/null || true
                continue
            fi
        fi
        if [[ "$waited" -ge "$METRIC_LOCK_WAIT_TICKS" ]]; then
            return 1
        fi
        sleep 0.01 2>/dev/null || sleep 1
        waited=$((waited + 1))
    done
}

_metric_lock_release() {
    local lock_dir="$1"
    rm -f "$lock_dir/pid" 2>/dev/null || true
    rmdir "$lock_dir" 2>/dev/null || true
}

# _metric_locked_jq <file> <jq_program> [jq_args...]
# Serialized read-modify-write of a metrics json file. Acquires the file's lock,
# runs `jq <args> <program> file > file.tmp.$$ && mv`, releases. Per-PID temp file
# means even a (skipped-lock) racing writer can't clobber a sibling's temp. On lock
# timeout: SKIP with a log line and return 0 — a run is NEVER stalled for a metric.
# Always returns 0 (a metrics failure must not trip the chain-runner's `set -e`).
_metric_locked_jq() {
    local file="$1" program="$2"; shift 2
    local lock_dir="${file}.lock" tmp="${file}.tmp.$$"
    if ! _metric_lock_acquire "$lock_dir"; then
        echo "  metrics: lock busy for $(basename "$file") — skipping write (run not blocked)" >&2
        return 0
    fi
    if jq "$@" "$program" "$file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
        mv "$tmp" "$file" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
    else
        rm -f "$tmp" 2>/dev/null || true
    fi
    _metric_lock_release "$lock_dir"
    return 0
}

# -------------------------------------------------------------------
# metric-start-timer: start a timer
# -------------------------------------------------------------------
# args: <timer-name>
metric-start-timer() {
    local name="$1"
    local start=$(date +%s%N)  # nanoseconds

    _metric_locked_jq "$ACTIVE_TIMERS_FILE" '
        .[$name] = $start
    ' --arg name "$name" --arg start "$start"
}

# -------------------------------------------------------------------
# metric-end-timer: end a timer and record duration (ms)
# -------------------------------------------------------------------
# args: <timer-name> [metric-type]
# metric-type: 'agent' (default), 'run', 'webhook'
metric-end-timer() {
    local name="$1"
    local metric_type="${2:-agent}"
    local end=$(date +%s%N)

    # get start time
    local start=$(jq -r --arg name "$name" '.[$name] // "0"' "$ACTIVE_TIMERS_FILE")

    if [[ "$start" == "0" ]]; then
        return 1
    fi

    # calculate duration in milliseconds
    local duration_ms=$(( (end - start) / 1000000 ))

    # remove from active timers (locked RMW)
    _metric_locked_jq "$ACTIVE_TIMERS_FILE" 'del(.[$name])' --arg name "$name"

    # record in timers (locked RMW)
    local timer_key="${metric_type}_${name}"
    _metric_locked_jq "$TIMERS_FILE" '
        if .[$key] then
            .[$key].count += 1 |
            .[$key].total_ms += $dur |
            .[$key].avg_ms = (.[$key].total_ms / .[$key].count | floor) |
            if $dur > .[$key].max_ms then .[$key].max_ms = $dur else . end |
            if $dur < .[$key].min_ms then .[$key].min_ms = $dur else . end
        else
            .[$key] = {
                count: 1,
                total_ms: $dur,
                avg_ms: $dur,
                min_ms: $dur,
                max_ms: $dur,
                type: $metric_type
            }
        end
    ' --arg key "$timer_key" --argjson dur "$duration_ms" --arg metric_type "$metric_type"

    echo "$duration_ms"
}

# -------------------------------------------------------------------
# metric-counter: increment a counter
# -------------------------------------------------------------------
# args: <metric-name> [<delta>]
metric-counter() {
    local name="$1"
    local delta="${2:-1}"

    _metric_locked_jq "$COUNTERS_FILE" '
        .[$name] = ((.[$name] // 0) + $delta)
    ' --arg name "$name" --argjson delta "$delta"
}

# -------------------------------------------------------------------
# metric-gauge: set a gauge value
# -------------------------------------------------------------------
# args: <metric-name> <value>
metric-gauge() {
    local name="$1"
    local value="$2"

    _metric_locked_jq "$GAUGES_FILE" '
        .[$name] = $val
    ' --arg name "$name" --argjson val "$value"
}

# -------------------------------------------------------------------
# metric-webhook: record webhook delivery result
# -------------------------------------------------------------------
# args: <event-type> <status> <response-time-ms>
metric-webhook() {
    local event_type="$1"
    local status="$2"  # 'delivered' or 'failed'
    local response_time="${3:-0}"

    _metric_locked_jq "$WEBHOOK_METRICS_FILE" '
        .total += 1 |
        if $status == "delivered" then
            .delivered += 1
        else
            .failed += 1
        end |
        .by_event[$event] = ((.by_event[$event] // {total:0,delivered:0,failed:0,total_rt:0}) |
            .total += 1 |
            if $status == "delivered" then .delivered += 1 else .failed += 1 end |
            .total_rt += $rt
        )
    ' --arg event "$event_type" --arg status "$status" --argjson rt "$response_time"
}

# -------------------------------------------------------------------
# get-metrics-json: output all metrics as json
# -------------------------------------------------------------------
get-metrics-json() {
    jq -n \
        --argjson counters "$(cat "$COUNTERS_FILE")" \
        --argjson gauges "$(cat "$GAUGES_FILE")" \
        --argjson timers "$(cat "$TIMERS_FILE")" \
        --argjson webhooks "$(cat "$WEBHOOK_METRICS_FILE")" \
        --arg generated "$(date -Iseconds)" \
        '{
            generated: $generated,
            counters: $counters,
            gauges: $gauges,
            timers: $timers,
            webhooks: $webhooks
        }'
}

# -------------------------------------------------------------------
# get-prometheus-metrics: output in prometheus text format
# -------------------------------------------------------------------
get-prometheus-metrics() {
    echo "# mentiko metrics"
    echo "# generated $(date -Iseconds)"
    echo ""

    # counters
    echo "# HELP mentiko_counter Counter metrics"
    echo "# TYPE mentiko_counter gauge"
    jq -r 'to_entries[] | "mentiko_counter{name=\"\(.key)\"} \(.value)"' "$COUNTERS_FILE" 2>/dev/null || true
    echo ""

    # gauges
    echo "# HELP mentiko_gauge Gauge metrics"
    echo "# TYPE mentiko_gauge gauge"
    jq -r 'to_entries[] | "mentiko_gauge{name=\"\(.key)\"} \(.value)"' "$GAUGES_FILE" 2>/dev/null || true
    echo ""

    # timers
    echo "# HELP mentiko_timer_ms Timer metrics in milliseconds"
    echo "# TYPE mentiko_timer_count gauge"
    jq -r 'to_entries[] | "mentiko_timer_count{name=\"\(.key)\"} \(.value.count)"' "$TIMERS_FILE" 2>/dev/null || true

    echo "# TYPE mentiko_timer_avg_ms gauge"
    jq -r 'to_entries[] | "mentiko_timer_avg_ms{name=\"\(.key)\"} \(.value.avg_ms)"' "$TIMERS_FILE" 2>/dev/null || true

    echo "# TYPE mentiko_timer_max_ms gauge"
    jq -r 'to_entries[] | "mentiko_timer_max_ms{name=\"\(.key)\"} \(.value.max_ms)"' "$TIMERS_FILE" 2>/dev/null || true

    echo ""

    # webhooks
    echo "# HELP mentiko_webhook_total Total webhooks sent"
    echo "# TYPE mentiko_webhook_total counter"
    echo "mentiko_webhook_total $(jq -r '.total' "$WEBHOOK_METRICS_FILE")"

    echo "# HELP mentiko_webhook_delivered Total webhooks delivered"
    echo "# TYPE mentiko_webhook_delivered counter"
    echo "mentiko_webhook_delivered $(jq -r '.delivered' "$WEBHOOK_METRICS_FILE")"

    echo "# HELP mentiko_webhook_failed Total webhooks failed"
    echo "# TYPE mentiko_webhook_failed counter"
    echo "mentiko_webhook_failed $(jq -r '.failed' "$WEBHOOK_METRICS_FILE")"

    echo "# HELP mentiko_webhook_success_rate Webhook success rate percentage"
    echo "# TYPE mentiko_webhook_success_rate gauge"
    local total=$(jq -r '.total' "$WEBHOOK_METRICS_FILE")
    local delivered=$(jq -r '.delivered' "$WEBHOOK_METRICS_FILE")
    if [[ "$total" -gt 0 ]]; then
        local rate=$(awk "BEGIN {printf \"%.2f\", ($delivered / $total) * 100}")
        echo "mentiko_webhook_success_rate $rate"
    else
        echo "mentiko_webhook_success_rate 0"
    fi

    echo ""

    # by event
    echo "# HELP mentiko_webhook_by_event Webhooks by event type"
    echo "# TYPE mentiko_webhook_by_event counter"
    jq -r '.by_event | to_entries[] | "mentiko_webhook_by_event{event=\"\(.key)\",status=\"delivered\"} \(.value.delivered)"' "$WEBHOOK_METRICS_FILE" 2>/dev/null || true
    jq -r '.by_event | to_entries[] | "mentiko_webhook_by_event{event=\"\(.key)\",status=\"failed\"} \(.value.failed)"' "$WEBHOOK_METRICS_FILE" 2>/dev/null || true
}

# -------------------------------------------------------------------
# reset-metrics: clear all metrics
# -------------------------------------------------------------------
reset-metrics() {
    echo '{}' > "$COUNTERS_FILE"
    echo '{}' > "$GAUGES_FILE"
    echo '{}' > "$TIMERS_FILE"
    echo '{"total":0,"delivered":0,"failed":0,"by_event":{}}' > "$WEBHOOK_METRICS_FILE"
    echo "  metrics reset"
}

# -------------------------------------------------------------------
# show-metrics: display metrics summary
# -------------------------------------------------------------------
show-metrics() {
    echo ""
    echo "  mentiko metrics:"
    echo "  ---"

    echo "  counters:"
    jq -r 'to_entries[] | "    \(.key): \(.value)"' "$COUNTERS_FILE" 2>/dev/null | sed 's/^/    /' || echo "    (none)"

    echo ""
    echo "  gauges:"
    jq -r 'to_entries[] | "    \(.key): \(.value)"' "$GAUGES_FILE" 2>/dev/null | sed 's/^/    /' || echo "    (none)"

    echo ""
    echo "  timers (avg ms):"
    jq -r 'to_entries[] | "    \(.key): \(.value.avg_ms)ms (\(.value.count) calls)"' "$TIMERS_FILE" 2>/dev/null | sed 's/^/    /' || echo "    (none)"

    echo ""
    echo "  webhooks:"
    local total=$(jq -r '.total' "$WEBHOOK_METRICS_FILE")
    local delivered=$(jq -r '.delivered' "$WEBHOOK_METRICS_FILE")
    local failed=$(jq -r '.failed' "$WEBHOOK_METRICS_FILE")
    echo "    total: $total"
    echo "    delivered: $delivered"
    echo "    failed: $failed"
    if [[ "$total" -gt 0 ]]; then
        local rate=$(awk "BEGIN {printf \"%.1f\", ($delivered / $total) * 100}")
        echo "    success rate: ${rate}%"
    fi
    echo ""
}

# exports
export -f _metric_lock_acquire
export -f _metric_lock_release
export -f _metric_locked_jq
export -f metric-start-timer
export -f metric-end-timer
export -f metric-counter
export -f metric-gauge
export -f metric-webhook
export -f get-metrics-json
export -f get-prometheus-metrics
export -f reset-metrics
export -f show-metrics
