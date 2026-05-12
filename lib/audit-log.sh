#!/bin/bash
# audit-log.sh - comprehensive audit logging for mentiko
#
# tracks:
#   - user actions (cli commands, web interactions)
#   - chain executions (start, complete, fail)
#   - config changes
#   - authentication events
#   - agent lifecycle (launch, kill, etc)
#
# usage:
#   source audit-log.sh
#   audit-log <event-type> "<description>" [key=value ...]
#   audit-log-chain-start <chain-file> <run-id>
#   audit-log-chain-complete <run-id> <status>
#   audit-log-auth <event> <user> <ip> <success>
#   audit-log-config-change <key> <old-value> <new-value>
#   audit-export-json
#   audit-export-csv

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# -------------------------------------------------------------------
# audit config
# -------------------------------------------------------------------

AUDIT_DIR="${AUDIT_DIR:-$NAMESPACE_ROOT/audit}"
AUDIT_FILE="${AUDIT_FILE:-$AUDIT_DIR/audit.log}"
AUDIT_INDEX="${AUDIT_INDEX:-$AUDIT_DIR/index.json}"

mkdir -p "$AUDIT_DIR"
[[ -f "$AUDIT_FILE" ]] || touch "$AUDIT_FILE"
[[ -f "$AUDIT_INDEX" ]] || echo '[]' > "$AUDIT_INDEX"

# max log size before rotation (100MB)
AUDIT_MAX_SIZE="${AUDIT_MAX_SIZE:-104857600}"
# max rotated logs to keep
AUDIT_MAX_FILES="${AUDIT_MAX_FILES:-10}"

# -------------------------------------------------------------------
# helpers
# -------------------------------------------------------------------

# get current user (prefer real user, fallback to logname)
get_audit_user() {
    echo "${AUDIT_USER:-${LOGNAME:-${USER:-$(whoami)}}}"
}

# get source (cli, web, api, system)
get_audit_source() {
    echo "${AUDIT_SOURCE:-cli}"
}

# get ip address (for web requests)
get_audit_ip() {
    echo "${AUDIT_IP:-}"
}

# generate unique audit id
generate_audit_id() {
    echo "audit_$(date +%s%N)_$$"
}

# rotate log if too large
rotate_audit_log() {
    if [[ -f "$AUDIT_FILE" ]]; then
        local size=$(stat -f%z "$AUDIT_FILE" 2>/dev/null || stat -c%s "$AUDIT_FILE" 2>/dev/null || echo 0)
        if [[ $size -gt $AUDIT_MAX_SIZE ]]; then
            # rotate existing logs
            for i in $(seq $((AUDIT_MAX_FILES - 1)) -1 1); do
                [[ -f "${AUDIT_FILE}.${i}" ]] && mv "${AUDIT_FILE}.${i}" "${AUDIT_FILE}.$((i + 1))"
            done
            [[ -f "$AUDIT_FILE" ]] && mv "$AUDIT_FILE" "${AUDIT_FILE}.1"
            touch "$AUDIT_FILE"
        fi
    fi
}

# escape json string
json_escape() {
    local string="$1"
    string="${string//\\/\\\\}"
    string="${string//\"/\\\"}"
    string="${string//$'\n'/\\n}"
    string="${string//$'\r'/\\r}"
    string="${string//$'\t'/\\t}"
    echo "$string"
}

# -------------------------------------------------------------------
# core audit log function
# -------------------------------------------------------------------
# args: <event-type> "<description>" [key=value ...]
audit-log() {
    local event_type="$1"
    shift
    local description="$1"
    shift

    local audit_id=$(generate_audit_id)
    local timestamp=$(date -Iseconds)
    local user=$(get_audit_user)
    local source=$(get_audit_source)
    local ip=$(get_audit_ip)
    local hostname=$(hostname -f 2>/dev/null || hostname)

    # build metadata from remaining args (PII-safe: reject email/name)
    local metadata=""
    local meta_sep=""
    while [[ $# -gt 0 ]]; do
        local key="${1%%=*}"
        local value="${1#*=}"

        # reject PII keys — audit log must not contain email or name
        if [[ "$key" =~ ^(email|name|user_email|user_name|username)$ ]]; then
            echo "[audit] WARNING: PII key '$key' rejected from audit log (use user_id instead)" >&2
            shift
            continue
        fi

        # reject values that look like email addresses
        if [[ "$value" =~ [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,} ]]; then
            echo "[audit] WARNING: PII value (email) rejected from audit log for key '$key'" >&2
            shift
            continue
        fi

        local safe_value=$(json_escape "$value")
        metadata+="${meta_sep}\"$key\":\"$safe_value\""
        meta_sep=","
        shift
    done

    # build json entry (compact format for JSONL)
    local json_entry="{\"id\":\"$audit_id\",\"timestamp\":\"$timestamp\",\"event_type\":\"$event_type\",\"description\":\"$(json_escape "$description")\",\"user\":\"$user\",\"source\":\"$source\",\"ip\":\"$ip\",\"hostname\":\"$hostname\",\"metadata\":{${metadata}}}"

    # append to log file (one json per line for easy parsing)
    rotate_audit_log
    echo "$json_entry" >> "$AUDIT_FILE"

    # ship to remote storage (background, non-blocking, optional).
    # if AUDIT_REMOTE_URL is unset, the shipper exits 0 silently.
    # stderr is appended to ship.log (not discarded) so ops can surface
    # "warn: audit ship failed..." without relying on container stdout.
    local ship_log="${AUDIT_DIR:-$NAMESPACE_ROOT/audit}/ship.log"
    mkdir -p "$(dirname "$ship_log")" 2>/dev/null
    echo "$json_entry" | bash "${SCRIPT_DIR}/audit-ship.sh" >/dev/null 2>>"$ship_log" &

    # update index (keep last 1000 in memory index for fast queries)
    local tmp_index=$(mktemp)
    if jq --argjson new "$json_entry" '[limit(1000; .[])] | [$new] + .' "$AUDIT_INDEX" 2>/dev/null > "$tmp_index"; then
        : # jq wrote to tmp_index
    else
        echo "[$json_entry]" > "$tmp_index"
    fi
    if [[ -s "$tmp_index" ]]; then
        mv "$tmp_index" "$AUDIT_INDEX"
    else
        rm -f "$tmp_index"
    fi

    echo "$audit_id"
}

# -------------------------------------------------------------------
# chain execution logging
# -------------------------------------------------------------------
audit-log-chain-start() {
    local chain_file="$1"
    local run_id="${2:-}"

    local chain_name=$(jq -r '.name // "unknown"' "$chain_file" 2>/dev/null || echo "unknown")
    local agent_count=$(jq -r '.agents | length' "$chain_file" 2>/dev/null || echo "0")

    audit-log "chain_start" \
        "Started chain: $chain_name" \
        "chain_name=$chain_name" \
        "chain_file=$chain_file" \
        "run_id=$run_id" \
        "agent_count=$agent_count" \
        "namespace_id=$NAMESPACE_ID"
}

audit-log-chain-complete() {
    local run_id="$1"
    local status="$2"  # success, failed, cancelled
    local duration_ms="${3:-}"
    local error_msg="${4:-}"

    local metadata="run_id=$run_id,status=$status"
    [[ -n "$duration_ms" ]] && metadata+=",duration_ms=$duration_ms"
    [[ -n "$error_msg" ]] && metadata+=",error=$(json_escape "$error_msg")"

    audit-log "chain_complete" \
        "Chain run completed: $status" \
        $metadata
}

audit-log-agent-launch() {
    local agent_id="$1"
    local agent_name="$2"
    local session="$3"
    local run_id="${4:-}"

    audit-log "agent_launch" \
        "Launched agent: $agent_name" \
        "agent_id=$agent_id" \
        "agent_name=$agent_name" \
        "session=$session" \
        "run_id=$run_id"
}

audit-log-agent-complete() {
    local agent_id="$1"
    local session="$2"
    local status="${3:-success}"
    local duration_ms="${4:-}"

    local metadata="agent_id=$agent_id,session=$session,status=$status"
    [[ -n "$duration_ms" ]] && metadata+=",duration_ms=$duration_ms"

    audit-log "agent_complete" \
        "Agent completed: $status" \
        $metadata
}

# -------------------------------------------------------------------
# config change logging
# -------------------------------------------------------------------
audit-log-config-change() {
    local key="$1"
    local old_value="$2"
    local new_value="$3"
    local scope="${4:-global}"

    audit-log "config_change" \
        "Config changed: $key" \
        "config_key=$key" \
        "old_value=$(json_escape "$old_value")" \
        "new_value=$(json_escape "$new_value")" \
        "scope=$scope"
}

audit-log-chain-edit() {
    local chain_file="$1"
    local action="${2:-modified}"  # created, deleted, modified
    local details="${3:-}"

    local chain_name=$(basename "$chain_file" .json)
    local metadata="chain_file=$chain_file,chain_name=$chain_name,action=$action"
    [[ -n "$details" ]] && metadata+=",details=$(json_escape "$details")"

    audit-log "chain_edit" \
        "Chain $action: $chain_name" \
        $metadata
}

# -------------------------------------------------------------------
# authentication logging
# -------------------------------------------------------------------
audit-log-auth() {
    local event="$1"  # login, logout, failed_login, password_change
    local user="${2:-}"
    local ip="${3:-unknown}"
    local success="${4:-true}"
    local details="${5:-}"

    local status="success"
    [[ "$success" != "true" ]] && status="failed"

    local metadata="auth_event=$event,user=$user,ip=$ip,status=$status"
    [[ -n "$details" ]] && metadata+=",details=$(json_escape "$details")"

    audit-log "auth" \
        "Auth $event: $user" \
        $metadata
}

# -------------------------------------------------------------------
# user action logging
# -------------------------------------------------------------------
audit-log-cli-command() {
    local command="$1"
    shift
    local args="$*"

    audit-log "cli_command" \
        "CLI command: $command" \
        "command=$command" \
        "args=$(json_escape "$args")"
}

audit-log-agent-action() {
    local action="$1"  # kill, peek, send, etc
    local target="$2"  # session name or agent id
    local details="${3:-}"

    local metadata="action=$action,target=$target"
    [[ -n "$details" ]] && metadata+=",details=$(json_escape "$details")"

    audit-log "agent_action" \
        "Agent action: $action $target" \
        $metadata
}

audit-log-event-emit() {
    local event_name="$1"
    local source="$2"
    local data="${3:-}"

    local metadata="event_name=$event_name,source=$source"
    [[ -n "$data" ]] && metadata+=",data=$(json_escape "$data")"

    audit-log "event_emit" \
        "Event emitted: $event_name" \
        $metadata
}

# -------------------------------------------------------------------
# query functions
# -------------------------------------------------------------------
# get logs filtered by criteria
audit-query() {
    local filter_type="${1:-all}"
    local filter_value="${2:-}"
    local since="${3:-}"
    local limit="${4:-100}"

    local jq_filter="."

    case "$filter_type" in
        event_type)
            jq_filter='.[] | select(.event_type == "'"$filter_value"'")'
            ;;
        user)
            jq_filter='.[] | select(.user == "'"$filter_value"'")'
            ;;
        chain)
            jq_filter='.[] | select(.event_type == "chain_start" or .event_type == "chain_complete") | select(.metadata.chain_name == "'"$filter_value"'")'
            ;;
        run_id)
            jq_filter='.[] | select(.metadata.run_id == "'"$filter_value"'")'
            ;;
        auth)
            jq_filter='.[] | select(.event_type == "auth")'
            ;;
        all)
            jq_filter='.[]'
            ;;
    esac

    # handle time filter
    if [[ -n "$since" ]]; then
        local since_ts=$(date -d "$since" +%s 2>/dev/null || echo "0")
        jq_filter="$jq_filter | select(.timestamp | fromdateiso8601 >= $since_ts)"
    fi

    # limit results
    jq_filter="[$jq_filter] | .[0:$limit]"

    jq "$jq_filter" "$AUDIT_INDEX" 2>/dev/null || echo "[]"
}

# -------------------------------------------------------------------
# export functions
# -------------------------------------------------------------------
# export all logs as json
audit-export-json() {
    local output_file="${1:-}"
    local since="${2:-}"
    local event_type="${3:-}"

    local tmp_file=$(mktemp)

    if [[ -z "$since" && -z "$event_type" ]]; then
        # export all
        cat "$AUDIT_FILE" | jq -s '.' > "$tmp_file"
    else
        # filtered export
        local filter='.'
        [[ -n "$event_type" ]] && filter+=' | select(.event_type == "'"$event_type"'")'
        if [[ -n "$since" ]]; then
            local since_ts=$(date -d "$since" +%s 2>/dev/null || echo "0")
            filter+=' | select(.timestamp | fromdateiso8601 >= '"$since_ts"')'
        fi
        echo "[" > "$tmp_file"
        local first=true
        while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                local matched=$(echo "$line" | jq "$filter" 2>/dev/null)
                if [[ -n "$matched" && "$matched" != "null" ]]; then
                    [[ "$first" == "true" ]] && first=false || echo "," >> "$tmp_file"
                    echo "$matched" >> "$tmp_file"
                fi
            fi
        done < "$AUDIT_FILE"
        echo "]" >> "$tmp_file"
    fi

    if [[ -n "$output_file" ]]; then
        mv "$tmp_file" "$output_file"
        echo "  exported to: $output_file"
    else
        cat "$tmp_file"
        rm -f "$tmp_file"
    fi
}

# export as csv
audit-export-csv() {
    local output_file="${1:-}"
    local since="${2:-}"
    local event_type="${3:-}"

    local tmp_file=$(mktemp)

    # csv header
    echo "id,timestamp,event_type,description,user,source,ip,hostname,metadata" > "$tmp_file"

    # filter and convert
    local filter='.'
    [[ -n "$event_type" ]] && filter+=' | select(.event_type == "'"$event_type"'")'
    if [[ -n "$since" ]]; then
        local since_ts=$(date -d "$since" +%s 2>/dev/null || echo "0")
        filter+=' | select(.timestamp | fromdateiso8601 >= '"$since_ts"')'
    fi

    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            local matched=$(echo "$line" | jq -r "$filter" 2>/dev/null)
            if [[ -n "$matched" && "$matched" != "null" ]]; then
                local id=$(echo "$matched" | jq -r '.id // ""')
                local timestamp=$(echo "$matched" | jq -r '.timestamp // ""')
                local etype=$(echo "$matched" | jq -r '.event_type // ""')
                local desc=$(echo "$matched" | jq -r '.description // ""' | tr ',' ' ')
                local user=$(echo "$matched" | jq -r '.user // ""')
                local source=$(echo "$matched" | jq -r '.source // ""')
                local ip=$(echo "$matched" | jq -r '.ip // ""')
                local hostname=$(echo "$matched" | jq -r '.hostname // ""')
                local metadata=$(echo "$matched" | jq -c '.metadata // {}' | tr ',' ';')

                echo "$id,$timestamp,$etype,\"$desc\",$user,$source,$ip,$hostname,\"$metadata\"" >> "$tmp_file"
            fi
        fi
    done < "$AUDIT_FILE"

    if [[ -n "$output_file" ]]; then
        mv "$tmp_file" "$output_file"
        echo "  exported to: $output_file"
    else
        cat "$tmp_file"
        rm -f "$tmp_file"
    fi
}

# -------------------------------------------------------------------
# summary functions
# -------------------------------------------------------------------
audit-summary() {
    local since="${1:-}"

    echo ""
    echo "  audit log summary:"
    echo "  ---"
    echo "  log file: $AUDIT_FILE"
    echo "  index: $AUDIT_INDEX"
    echo "  namespace: $NAMESPACE_ID"
    echo ""

    if [[ ! -s "$AUDIT_FILE" ]]; then
        echo "  (no logs yet)"
        echo ""
        return
    fi

    # event type counts
    echo "  events by type:"
    jq -r 'group_by(.event_type) | map({event: .[0].event_type, count: length}) | sort_by(.count) | reverse | .[] | "    \(.event): \(.count)"' "$AUDIT_INDEX" 2>/dev/null | sed 's/^/    /' || echo "    (none)"

    echo ""

    # recent activity
    echo "  recent activity (last 10):"
    jq -r '.[0:10] | .[] | "[\(.timestamp[0:19])] \(.event_type): \(.description)"' "$AUDIT_INDEX" 2>/dev/null | sed 's/^/    /' || echo "    (none)"

    echo ""

    # auth events
    echo "  auth events (last 10):"
    local auth_count=$(jq '[.[] | select(.event_type == "auth")] | length' "$AUDIT_INDEX" 2>/dev/null || echo "0")
    echo "    total: $auth_count"
    jq -r '[.[] | select(.event_type == "auth")] | .[0:10] | .[] | "    [\(.timestamp[0:19])] \(.metadata.auth_event): \(.user) (\(.metadata.status))"' "$AUDIT_INDEX" 2>/dev/null || echo "    (none)"

    echo ""
}

# -------------------------------------------------------------------
# maintenance functions
# -------------------------------------------------------------------
# archive old logs
audit-archive() {
    local days="${1:-30}"

    local cutoff_date=$(date -d "$days days ago" +%Y%m%d 2>/dev/null || date -v-${days}d +%Y%m%d)
    local archive_file="$AUDIT_DIR/archive-${cutoff_date}.jsonl.gz"

    echo "  archiving logs older than $days days..."

    # find old entries, move to archive, compress
    local tmp_file=$(mktemp)
    local cutoff_ts=$(date -d "$days days ago" +%s 2>/dev/null || date -v-${days}d +%s)

    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            local ts=$(echo "$line" | jq -r '.timestamp // "" | fromdateiso8601' 2>/dev/null || echo "0")
            if [[ $ts -lt $cutoff_ts ]]; then
                echo "$line" >> "$tmp_file"
            fi
        fi
    done < "$AUDIT_FILE"

    if [[ -s "$tmp_file" ]]; then
        gzip -c "$tmp_file" > "$archive_file"
        # remove archived from main log
        local new_tmp=$(mktemp)
        while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                local ts=$(echo "$line" | jq -r '.timestamp // "" | fromdateiso8601' 2>/dev/null || echo "0")
                if [[ $ts -ge $cutoff_ts ]]; then
                    echo "$line" >> "$new_tmp"
                fi
            fi
        done < "$AUDIT_FILE"
        mv "$new_tmp" "$AUDIT_FILE"
        rm -f "$tmp_file"

        local count=$(zcat "$archive_file" | wc -l)
        echo "  archived $count entries to $archive_file"
    else
        rm -f "$tmp_file"
        echo "  nothing to archive"
    fi
}

# clear all audit logs (use with caution)
audit-clear() {
    local confirm="${1:-}"

    if [[ "$confirm" != "--confirm" ]]; then
        echo "  warning: this will delete all audit logs"
        echo "  usage: audit-clear --confirm"
        return 1
    fi

    echo "[]" > "$AUDIT_INDEX"
    > "$AUDIT_FILE"
    echo "  audit logs cleared"
}

# exports
export -f audit-log
export -f audit-log-chain-start
export -f audit-log-chain-complete
export -f audit-log-agent-launch
export -f audit-log-agent-complete
export -f audit-log-config-change
export -f audit-log-chain-edit
export -f audit-log-auth
export -f audit-log-cli-command
export -f audit-log-agent-action
export -f audit-log-event-emit
export -f audit-query
export -f audit-export-json
export -f audit-export-csv
export -f audit-summary
export -f audit-archive
export -f audit-clear
