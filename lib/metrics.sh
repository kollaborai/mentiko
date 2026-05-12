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

# -------------------------------------------------------------------
# metric-start-timer: start a timer
# -------------------------------------------------------------------
# args: <timer-name>
metric-start-timer() {
    local name="$1"
    local start=$(date +%s%N)  # nanoseconds

    jq --arg name "$name" --arg start "$start" '
        .[$name] = $start
    ' "$ACTIVE_TIMERS_FILE" > "$ACTIVE_TIMERS_FILE.tmp"
    mv "$ACTIVE_TIMERS_FILE.tmp" "$ACTIVE_TIMERS_FILE"
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

    # remove from active timers
    jq --arg name "$name" 'del(.[$name])' "$ACTIVE_TIMERS_FILE" > "$ACTIVE_TIMERS_FILE.tmp"
    mv "$ACTIVE_TIMERS_FILE.tmp" "$ACTIVE_TIMERS_FILE"

    # record in timers
    local timer_key="${metric_type}_${name}"
    jq --arg key "$timer_key" --argjson dur "$duration_ms" '
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
    ' "$TIMERS_FILE" > "$TIMERS_FILE.tmp"
    mv "$TIMERS_FILE.tmp" "$TIMERS_FILE"

    echo "$duration_ms"
}

# -------------------------------------------------------------------
# metric-counter: increment a counter
# -------------------------------------------------------------------
# args: <metric-name> [<delta>]
metric-counter() {
    local name="$1"
    local delta="${2:-1}"

    jq --arg name "$name" --argjson delta "$delta" '
        .[$name] = ((.[$name] // 0) + $delta)
    ' "$COUNTERS_FILE" > "$COUNTERS_FILE.tmp"
    mv "$COUNTERS_FILE.tmp" "$COUNTERS_FILE"
}

# -------------------------------------------------------------------
# metric-gauge: set a gauge value
# -------------------------------------------------------------------
# args: <metric-name> <value>
metric-gauge() {
    local name="$1"
    local value="$2"

    jq --arg name "$name" --argjson val "$value" '
        .[$name] = $val
    ' "$GAUGES_FILE" > "$GAUGES_FILE.tmp"
    mv "$GAUGES_FILE.tmp" "$GAUGES_FILE"
}

# -------------------------------------------------------------------
# metric-webhook: record webhook delivery result
# -------------------------------------------------------------------
# args: <event-type> <status> <response-time-ms>
metric-webhook() {
    local event_type="$1"
    local status="$2"  # 'delivered' or 'failed'
    local response_time="${3:-0}"

    jq --arg event "$event_type" \
       --arg status "$status" \
       --argjson rt "$response_time" '
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
    ' "$WEBHOOK_METRICS_FILE" > "$WEBHOOK_METRICS_FILE.tmp"
    mv "$WEBHOOK_METRICS_FILE.tmp" "$WEBHOOK_METRICS_FILE"
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
export -f metric-start-timer
export -f metric-end-timer
export -f metric-counter
export -f metric-gauge
export -f metric-webhook
export -f get-metrics-json
export -f get-prometheus-metrics
export -f reset-metrics
export -f show-metrics
